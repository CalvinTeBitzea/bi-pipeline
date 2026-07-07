// ============================================================================
// WHAT THIS FILE IS, IN BUSINESS TERMS
// ============================================================================
// This is the single most important file in the chat app: it's the bridge
// between "the user typed a message and hit send" and "the AI agent team
// actually goes and does the work, live, with the user watching it happen."
// Every message a customer sends in the chat UI ends up here.
//
// It has two jobs:
//   1. Forward the user's message into the running agent conversation.
//   2. Open a live connection back to the browser and relay everything the
//      agent team does — its replies, which specialist is working, and any
//      "I need you to run this for me" requests — as it happens, not after
//      the fact. This is what powers the "watch it think" narration feature
//      in the chat UI.
//
// CONCEPT: This is a Next.js "API route" — a mini web server endpoint
// ------------------------------------------------------------------------------
// Next.js (the framework this app is built with) lets you define a backend
// HTTP endpoint just by exporting a function named after the HTTP verb
// (`POST`, `GET`, etc.) from a file at a matching URL path. This file lives
// at `app/api/chat/route.js`, so it automatically becomes the real server
// endpoint `POST /api/chat` — no separate server setup required. The
// browser-side chat component calls `fetch('/api/chat', ...)` and this is
// the code that runs in response, on Anthropic's/Vercel's servers, not in
// the user's browser.
//
// CONCEPT: Streaming a response as Server-Sent Events (SSE)
// ------------------------------------------------------------------------------
// A normal API call sends one request, waits, and gets back one full
// response. That doesn't work well here — an agent run can take minutes,
// and we want the user to see progress the whole time, not stare at a
// spinner. Instead, this route immediately returns a `ReadableStream` with
// the MIME type `text/event-stream` and then keeps writing small chunks of
// data into it (`send({...})` below) for as long as the agent run
// continues. The browser reads this the same way it reads a live news
// ticker — a continuous trickle of updates over one open connection —
// rather than one big finished document.
import Anthropic from '@anthropic-ai/sdk'
import { summarizeValidateResult, summarizeToolCall } from '../../../lib/activity'

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

// ----------------------------------------------------------------------------
// CONCEPT: Custom tools put YOU in charge of running the real logic
// ----------------------------------------------------------------------------
// bi-authoring's job description (see bi-authoring.agent.yaml) includes a
// "custom" tool called `validate_ir`. Unlike a built-in tool (read/write/
// etc — executed automatically inside Anthropic's own sandbox), a custom
// tool is a placeholder: when the agent "calls" it, the platform pauses and
// waits for OUR server to actually perform the action and hand back a
// result. This function is that action: it takes whatever IR (dashboard
// spec + semantic model) the agent produced and forwards it to the real,
// separately-deployed validation service (the "builder"/"bi-cohost" app)
// over plain HTTP, then relays whatever verdict comes back. This is the
// standard "function calling" / "tool use" pattern used across most AI
// agent platforms — the model decides WHEN and WITH WHAT ARGUMENTS to call
// something, but never runs the logic itself.
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
    // A network/plumbing failure is reported differently than "your file
    // failed validation" — the agent needs to know it's an infrastructure
    // problem it can't fix by editing the spec, not a real quality issue.
    const parsed = { valid: false, error: err?.message ?? String(err) }
    return { text: JSON.stringify(parsed), isError: true, parsed }
  }
}

export async function POST(request) {
  const { message, sessionId } = await request.json()
  const SESSION_ID = sessionId || DEFAULT_SESSION_ID

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const encoder = new TextEncoder()

  const readable = new ReadableStream({
    async start(controller) {
      // `send` is the one function every event handler below uses to push a
      // piece of data down to the browser. The `data: ...\n\n` framing is
      // the exact wire format Server-Sent Events requires — the browser's
      // built-in EventSource/fetch-stream reader knows to split on it.
      const send = (data) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

      // Sending the user message lives INSIDE this try block (not before the
      // stream is created) on purpose: a session can refuse a new message —
      // e.g. if a previous turn got killed mid-flight by this route's own
      // maxDuration limit and the session hasn't settled back to a state
      // that accepts new input yet. If that throw happened before the
      // stream existed, the client would get a bare, non-SSE error response
      // that the frontend's SSE reader has no way to interpret — it would
      // just look like the agent hung forever "thinking". Handling it here
      // means a rejected send surfaces as a real, visible error instead.
      try {
        await client.beta.sessions.events.send(SESSION_ID, {
          events: [{ type: 'user.message', content: [{ type: 'text', text: message }] }],
          betas: [BETA],
        })
      } catch (err) {
        send({ type: 'error', message: err?.message ?? String(err) })
        controller.close()
        return
      }

      // session_thread_id -> agent_name, populated as subagent threads spin up,
      // so cross-posted events (which carry a thread id but not the agent
      // name) can be attributed correctly — currently only needed for the
      // validate_ir narration line.
      const threadAgentNames = {}

      // --------------------------------------------------------------------
      // CONCEPT: Why a coordinator conversation needs MULTIPLE live streams
      // --------------------------------------------------------------------
      // Remember the org-chart picture from apply.py: the coordinator
      // delegates to specialist subagents by opening a private "thread"
      // (its own mini sub-conversation) with each one. Crucially, what a
      // subagent SAYS and WHICH TOOLS IT CALLS only ever show up in that
      // thread's OWN event stream — never on the main/primary stream the
      // user is watching. So to narrate "bi-design just wrote
      // dashboard_spec.json" live, in real time, we have to separately
      // subscribe to bi-design's own private thread stream too, not just
      // the primary one. This is a fan-out: one primary stream (the
      // coordinator's own conversation) plus one extra live stream PER
      // active subagent thread, all running concurrently, all feeding the
      // same `send()` pipe back to the browser.
      const subagentControllers = {}
      const subagentTasks       = []

      function startSubagentNarration(threadId, agentName) {
        // Each subagent stream gets its own AbortController so we can
        // deliberately stop listening to it (e.g. when the browser
        // disconnects, or the whole turn ends) without waiting for the
        // subagent itself to naturally finish.
        const controller2 = new AbortController()
        subagentControllers[threadId] = controller2
        const task = (async () => {
          try {
            const stream2 = await client.beta.sessions.threads.events.stream(
              threadId,
              { session_id: SESSION_ID, betas: [BETA] },
              { signal: controller2.signal },
            )
            for await (const event of stream2) {
              // agent.custom_tool_use (validate_ir) is deliberately NOT
              // handled here — it's cross-posted to the primary stream,
              // which is the only place that answers it. Handling it here
              // too would risk a second real call to /api/validate.
              if (event.type === 'agent.message') {
                // The subagent's own words — e.g. bi-design explaining a
                // design decision, or bi-authoring quoting a validation
                // error. This is exactly the "inline narration" content the
                // chat UI shows collapsed under each coordinator reply.
                const text = (event.content ?? []).map((b) => b.text ?? '').join('')
                if (text) send({ type: 'narration', agent: agentName, text })
              } else if (event.type === 'agent.tool_use') {
                // Turn a raw tool call (e.g. {name:'write', input:{file_path:...}})
                // into a short human sentence like "write dashboard_spec.json" —
                // see lib/activity.js for that translation.
                send({ type: 'narration', agent: agentName, text: summarizeToolCall(event.name, event.input) })
              } else if (event.type === 'session.thread_status_idle') {
                // This subagent thread has nothing left to do — unless it's
                // just paused waiting on a tool result we haven't sent yet
                // (requires_action), in which case there's more narration
                // coming and we should keep listening.
                if (event.stop_reason?.type !== 'requires_action') break
              } else if (event.type === 'session.thread_status_terminated') {
                break
              }
            }
          } catch (err) {
            if (err?.name !== 'AbortError') {
              console.error(`subagent narration stream failed (${agentName}/${threadId}):`, err?.message ?? err)
            }
          } finally {
            delete subagentControllers[threadId]
          }
        })()
        subagentTasks.push(task)
      }

      try {
        // The PRIMARY stream: the coordinator's own conversation with the
        // user. Everything the user sees by default (replies, "thinking",
        // which stage is active) comes from this loop; the subagent
        // narration streams above are an ADDITIONAL layer feeding the same
        // `send()` pipe concurrently.
        const stream = await client.beta.sessions.events.stream(SESSION_ID, { betas: [BETA] })

        for await (const event of stream) {
          const t = event.type

          if (t === 'agent.message') {
            // The coordinator's own reply text to the user.
            const text = (event.content ?? []).map((b) => b.text ?? '').join('')
            send({ type: 'message', text })
          } else if (t === 'agent.thinking') {
            // A signal (no content) that the model is reasoning before
            // producing its next visible output — used to show a "thinking"
            // indicator in the UI.
            send({ type: 'thinking' })
          } else if (t === 'agent.tool_use') {
            // A tool call made directly by the coordinator itself (rare —
            // it mostly just delegates), shown as a generic tool badge.
            send({ type: 'tool', name: event.name ?? 'tool' })
          } else if (t === 'agent.custom_tool_use') {
            // bi-authoring's validate_ir tool — call the deterministic builder
            // host-side, then answer via user.custom_tool_result so the
            // session can resume. Echo session_thread_id so the result routes
            // back to the originating subagent thread, not just the primary.
            send({ type: 'tool', name: event.name ?? 'validate_ir' })
            const agent = threadAgentNames[event.session_thread_id] ?? 'coordinator'

            if (event.name === 'validate_ir') {
              const { text, isError, parsed } = await runValidateIr(event.input ?? {})
              send({ type: 'narration', agent, text: `validate_ir → ${summarizeValidateResult(parsed)}` })
              // Answering the tool call: this is what lets the paused agent
              // conversation continue. Without sending this event back, the
              // session would sit waiting forever.
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
            }
          } else if (t === 'session.thread_created') {
            // A new specialist just got spun up (e.g. the coordinator
            // handed the spec to bi-design). Remember its name for later
            // attribution, tell the UI which stage is now active, and open
            // a dedicated narration stream for it (see above).
            threadAgentNames[event.session_thread_id] = event.agent_name
            const hint = SUBAGENT_HINTS[event.agent_name] ?? `${event.agent_name ?? 'subagent'} working…`
            send({ type: 'thinking', hint })
            startSubagentNarration(event.session_thread_id, event.agent_name)
          } else if (t === 'session.thread_status_running') {
            const hint = SUBAGENT_HINTS[event.agent_name] ?? `${event.agent_name ?? 'subagent'} working…`
            send({ type: 'thinking', hint })
          } else if (t === 'span.model_request_end') {
            // Every individual model call reports exactly how many tokens
            // it used — this is the raw data the token/cost-tracking
            // feature in the sidebar is built from (see lib/pricing.js).
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
        // Cleanup: whether the turn finished normally or the browser
        // disconnected mid-run, make sure every subagent narration stream we
        // opened gets explicitly closed (abort) and fully wound down
        // (awaited) before we close the outer SSE connection — otherwise
        // those background listeners would leak, still running after
        // nothing is left to read their output.
        for (const ctrl of Object.values(subagentControllers)) ctrl.abort()
        await Promise.allSettled(subagentTasks)
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
