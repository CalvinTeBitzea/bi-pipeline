import Anthropic from '@anthropic-ai/sdk'
import { summarizeValidateResult } from '../../../lib/activity'

const DEFAULT_SESSION_ID = process.env.REFERENCE_SESSION_ID || 'sesn_01S3zW6pLxWnwyxZ9rmB6tZB'
const BETA               = 'managed-agents-2026-04-01'

function fmt(isoStr) {
  return new Date(isoStr).toLocaleTimeString('en-AU', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const SESSION_ID = searchParams.get('sessionId') || DEFAULT_SESSION_ID
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const events = []
  for await (const e of client.beta.sessions.events.list(SESSION_ID, { betas: [BETA] })) {
    events.push(e)
  }
  events.sort((a, b) => new Date(a.processed_at) - new Date(b.processed_at))

  // Pre-index custom_tool_result events by the tool_use id they answer, so the
  // activity pass below can resolve a validate_ir call's outcome without a
  // second fetch — the result event always comes after the call in this list.
  const toolResultsByUseId = {}
  for (const e of events) {
    if (e.type === 'user.custom_tool_result') {
      const text = (e.content ?? []).map(b => b.text ?? '').join('')
      try { toolResultsByUseId[e.custom_tool_use_id] = JSON.parse(text) } catch {}
    }
  }

  // Reconstruct turns. Accumulate span.model_request_end token counts per turn.
  const messages = []
  let pendingUser  = null
  let pendingAgent = null
  let turnUsage    = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

  function resetTurnUsage() {
    turnUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  }

  // Reconstruct the activity log the same way chat/route.js builds it live:
  // session_thread_id -> agent_name from thread_created, then attribute
  // tool-use events to their owning subagent.
  const activity = []
  const threadAgentNames = {}

  for (const e of events) {
    if (e.type === 'user.message') {
      if (pendingUser)  messages.push(pendingUser)
      if (pendingAgent) messages.push({ ...pendingAgent, usage: { ...turnUsage } })
      pendingUser  = null
      pendingAgent = null
      resetTurnUsage()

      const text = (e.content ?? []).map(b => b.text ?? '').join('').trim()
      if (text) {
        pendingUser = { role: 'user', text, time: fmt(e.processed_at), id: e.id }
      }
    } else if (e.type === 'agent.message') {
      const text = (e.content ?? []).map(b => b.text ?? '').join('').trim()
      if (text) {
        pendingAgent = { role: 'agent', text, time: fmt(e.processed_at), id: e.id }
      }
    } else if (e.type === 'span.model_request_end') {
      const u = e.model_usage
      if (u) {
        turnUsage.input    += u.input_tokens ?? 0
        turnUsage.output   += u.output_tokens ?? 0
        turnUsage.cacheRead  += u.cache_read_input_tokens ?? 0
        turnUsage.cacheWrite += u.cache_creation_input_tokens ?? 0
      }
    } else if (e.type === 'agent.thread_context_compacted') {
      // Flush any in-progress turn before inserting the compaction marker
      if (pendingUser)  messages.push(pendingUser)
      if (pendingAgent) messages.push({ ...pendingAgent, usage: { ...turnUsage } })
      pendingUser  = null
      pendingAgent = null
      resetTurnUsage()
      messages.push({ role: 'compacted', id: e.id, time: fmt(e.processed_at) })
    } else if (e.type === 'session.status_idle') {
      // Only the PRIMARY session idling (and only when genuinely done, not
      // paused on requires_action for a pending tool result) closes a turn.
      // Previously this checked session.thread_status_idle, which now also
      // fires once per subagent in the multiagent roster — that flushed and
      // reset pendingAgent on every subagent transition, splitting what
      // should be one coordinator message into several. Fixed alongside the
      // activity-log addition since both read the same event pass.
      if (e.stop_reason?.type === 'requires_action') continue
      if (pendingAgent) pendingAgent = { ...pendingAgent, usage: { ...turnUsage } }
      if (pendingUser)  messages.push(pendingUser)
      if (pendingAgent) messages.push(pendingAgent)
      pendingUser  = null
      pendingAgent = null
      resetTurnUsage()
    } else if (e.type === 'session.thread_created') {
      threadAgentNames[e.session_thread_id] = e.agent_name
      activity.push({ id: e.id, time: fmt(e.processed_at), agent: e.agent_name, action: 'started' })
    } else if (e.type === 'agent.tool_use') {
      const agent = threadAgentNames[e.session_thread_id] ?? 'coordinator'
      activity.push({ id: e.id, time: fmt(e.processed_at), agent, action: 'tool_call', detail: e.name ?? 'tool' })
    } else if (e.type === 'agent.custom_tool_use') {
      const agent = threadAgentNames[e.session_thread_id] ?? 'coordinator'
      const detail = e.name === 'validate_ir'
        ? `validate_ir → ${summarizeValidateResult(toolResultsByUseId[e.id])}`
        : (e.name ?? 'tool')
      activity.push({ id: e.id, time: fmt(e.processed_at), agent, action: 'tool_call', detail })
    }
  }

  // Catch anything not closed by a terminal session.status_idle
  if (pendingUser)  messages.push(pendingUser)
  if (pendingAgent) messages.push({ ...pendingAgent, usage: { ...turnUsage } })

  return Response.json({ messages, activity })
}
