import Anthropic from '@anthropic-ai/sdk'
import { summarizeValidateResult } from '../../../lib/activity'

const DEFAULT_SESSION_ID = process.env.REFERENCE_SESSION_ID || 'sesn_01S3zW6pLxWnwyxZ9rmB6tZB'
const BETA               = 'managed-agents-2026-04-01'
const BICOHOST_URL       = process.env.NEXT_PUBLIC_BICOHOST_URL ?? ''

// Human-readable hints for the ThinkingBubble while a subagent thread is active.
const SUBAGENT_HINTS = {
  'bi-planner':   'bi-planner drafting spec…',
  'bi-design':    'bi-design generating…',
  'bi-authoring': 'bi-authoring validating…',
}

// Allow up to 5-minute responses for long agent runs
export const maxDuration = 300

async function runValidateIr(input) {
  try {
    const res = await fetch(`${BICOHOST_URL}/api/validate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        dashboard_spec: input.dashboard_spec,
        semantic_model: input.semantic_model,
      }),
    })
    const parsed = await res.json()
    return { text: JSON.stringify(parsed), isError: false, parsed }
  } catch (err) {
    const parsed = { valid: false, error: err?.message ?? String(err) }
    return { text: JSON.stringify(parsed), isError: true, parsed }
  }
}

export async function POST(request) {
  const { message, sessionId } = await request.json()
  const SESSION_ID = sessionId || DEFAULT_SESSION_ID

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // Send the user message to the Managed Agent session
  await client.beta.sessions.events.send(SESSION_ID, {
    events: [{ type: 'user.message', content: [{ type: 'text', text: message }] }],
    betas: [BETA],
  })

  const encoder = new TextEncoder()

  const readable = new ReadableStream({
    async start(controller) {
      const send = (data) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

      // session_thread_id -> agent_name, populated as subagent threads spin up,
      // so tool-use events (which carry a thread id but not the agent name) can
      // be attributed correctly in the activity log.
      const threadAgentNames = {}

      try {
        const stream = await client.beta.sessions.events.stream(SESSION_ID, { betas: [BETA] })

        for await (const event of stream) {
          const t = event.type

          if (t === 'agent.message') {
            const text = (event.content ?? []).map((b) => b.text ?? '').join('')
            send({ type: 'message', text })
          } else if (t === 'agent.thinking') {
            send({ type: 'thinking' })
          } else if (t === 'agent.tool_use') {
            send({ type: 'tool', name: event.name ?? 'tool' })
            const agent = threadAgentNames[event.session_thread_id] ?? 'coordinator'
            send({ type: 'activity', agent, action: 'tool_call', detail: event.name ?? 'tool' })
          } else if (t === 'agent.custom_tool_use') {
            // bi-authoring's validate_ir tool — call the deterministic builder
            // host-side, then answer via user.custom_tool_result so the
            // session can resume. Echo session_thread_id so the result routes
            // back to the originating subagent thread, not just the primary.
            send({ type: 'tool', name: event.name ?? 'validate_ir' })
            const agent = threadAgentNames[event.session_thread_id] ?? 'coordinator'

            if (event.name === 'validate_ir') {
              const { text, isError, parsed } = await runValidateIr(event.input ?? {})
              send({ type: 'activity', agent, action: 'tool_call', detail: `validate_ir → ${summarizeValidateResult(parsed)}` })
              await client.beta.sessions.events.send(SESSION_ID, {
                events: [{
                  type:               'user.custom_tool_result',
                  custom_tool_use_id: event.id,
                  session_thread_id:  event.session_thread_id,
                  content:            [{ type: 'text', text }],
                  is_error:           isError,
                }],
                betas: [BETA],
              })
            } else {
              send({ type: 'activity', agent, action: 'tool_call', detail: event.name ?? 'tool' })
            }
          } else if (t === 'session.thread_created') {
            threadAgentNames[event.session_thread_id] = event.agent_name
            const hint = SUBAGENT_HINTS[event.agent_name] ?? `${event.agent_name ?? 'subagent'} working…`
            send({ type: 'thinking', hint })
            send({ type: 'activity', agent: event.agent_name, action: 'started' })
          } else if (t === 'session.thread_status_running') {
            const hint = SUBAGENT_HINTS[event.agent_name] ?? `${event.agent_name ?? 'subagent'} working…`
            send({ type: 'thinking', hint })
          } else if (t === 'span.model_request_end') {
            const u = event.model_usage
            if (u) send({ type: 'usage', input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 })
          } else if (t === 'session.status_idle') {
            // Idle while `requires_action` (e.g. waiting on the
            // user.custom_tool_result we just sent) is NOT done — the
            // session resumes on its own once we answer. Only a terminal
            // idle (end_turn / retries_exhausted) means the turn is over.
            if (event.stop_reason?.type === 'requires_action') continue
            send({ type: 'done' })
            break
          } else if (t === 'session.error' || t === 'session.status_terminated') {
            send({ type: 'error', message: t })
            break
          }
        }
      } catch (err) {
        const msg = err?.message ?? String(err)
        const send2 = (data) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        send2({ type: 'error', message: msg })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection:      'keep-alive',
    },
  })
}
