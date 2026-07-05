import Anthropic from '@anthropic-ai/sdk'
import { summarizeValidateResult, summarizeToolCall } from '../../../lib/activity'

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

  // session_thread_id -> agent_name, populated as thread_created events are
  // seen below — used to attribute the validate_ir narration line and to
  // know which subagent threads to fetch narration from afterwards (their
  // own agent.message/agent.tool_use events never appear in this primary
  // event list — only on each thread's own event log).
  const threadAgentNames = {}
  const narrationEvents  = []   // {agent, time, text, at} — merged into turns below
  let turnStartTime      = null
  const turnBoundaries   = []   // {start, end, messageIndex} — end: null means "still open"

  for (const e of events) {
    if (e.type === 'user.message') {
      if (pendingUser)  messages.push(pendingUser)
      if (pendingAgent) {
        messages.push({ ...pendingAgent, usage: { ...turnUsage } })
        if (turnStartTime) turnBoundaries.push({ start: turnStartTime, end: e.processed_at, messageIndex: messages.length - 1 })
      }
      pendingUser  = null
      pendingAgent = null
      resetTurnUsage()
      turnStartTime = null

      const text = (e.content ?? []).map(b => b.text ?? '').join('').trim()
      if (text) {
        pendingUser = { role: 'user', text, time: fmt(e.processed_at), id: e.id }
        turnStartTime = e.processed_at
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
      if (pendingAgent) {
        messages.push({ ...pendingAgent, usage: { ...turnUsage } })
        if (turnStartTime) turnBoundaries.push({ start: turnStartTime, end: e.processed_at, messageIndex: messages.length - 1 })
      }
      pendingUser  = null
      pendingAgent = null
      resetTurnUsage()
      turnStartTime = null
      messages.push({ role: 'compacted', id: e.id, time: fmt(e.processed_at) })
    } else if (e.type === 'session.status_idle') {
      // Only the PRIMARY session idling (and only when genuinely done, not
      // paused on requires_action for a pending tool result) closes a turn.
      // Previously this checked session.thread_status_idle, which now also
      // fires once per subagent in the multiagent roster — that flushed and
      // reset pendingAgent on every subagent transition, splitting what
      // should be one coordinator message into several.
      if (e.stop_reason?.type === 'requires_action') continue
      if (pendingAgent) pendingAgent = { ...pendingAgent, usage: { ...turnUsage } }
      if (pendingUser)  messages.push(pendingUser)
      if (pendingAgent) {
        messages.push(pendingAgent)
        if (turnStartTime) turnBoundaries.push({ start: turnStartTime, end: e.processed_at, messageIndex: messages.length - 1 })
      }
      pendingUser  = null
      pendingAgent = null
      resetTurnUsage()
      turnStartTime = null
    } else if (e.type === 'session.thread_created') {
      threadAgentNames[e.session_thread_id] = e.agent_name
    } else if (e.type === 'agent.custom_tool_use') {
      // agent.tool_use is deliberately not collected here — on the primary
      // list those are always the coordinator's own calls, out of scope for
      // narration (mirrors chat/route.js, which only narrates subagent tool
      // calls via each thread's own stream).
      if (e.name === 'validate_ir') {
        const agent = threadAgentNames[e.session_thread_id] ?? 'coordinator'
        const text  = `validate_ir → ${summarizeValidateResult(toolResultsByUseId[e.id])}`
        narrationEvents.push({ agent, time: fmt(e.processed_at), text, at: e.processed_at })
      }
    }
  }

  // Catch anything not closed by a terminal session.status_idle
  if (pendingUser)  messages.push(pendingUser)
  if (pendingAgent) {
    messages.push({ ...pendingAgent, usage: { ...turnUsage } })
    if (turnStartTime) turnBoundaries.push({ start: turnStartTime, end: null, messageIndex: messages.length - 1 })
  }

  // Fetch each subagent thread's own event log (concurrently — a subagent
  // that respawned across revision rounds has more than one thread) and pull
  // out its narration the same way chat/route.js's per-thread consumer does.
  const threadIds = Object.keys(threadAgentNames)
  const threadEventLists = await Promise.all(
    threadIds.map((id) => (async () => {
      const evs = []
      for await (const e of client.beta.sessions.threads.events.list(id, { session_id: SESSION_ID, betas: [BETA] })) {
        evs.push(e)
      }
      return { agent: threadAgentNames[id], events: evs }
    })())
  )
  for (const { agent, events: evs } of threadEventLists) {
    for (const e of evs) {
      if (e.type === 'agent.message') {
        const text = (e.content ?? []).map((b) => b.text ?? '').join('').trim()
        if (text) narrationEvents.push({ agent, time: fmt(e.processed_at), text, at: e.processed_at })
      } else if (e.type === 'agent.tool_use') {
        narrationEvents.push({ agent, time: fmt(e.processed_at), text: summarizeToolCall(e.name, e.input), at: e.processed_at })
      }
    }
  }

  // Merge narration into the turn it happened during.
  narrationEvents.sort((a, b) => new Date(a.at) - new Date(b.at))
  for (const { start, end, messageIndex } of turnBoundaries) {
    const startMs = new Date(start).getTime()
    const endMs   = end ? new Date(end).getTime() : null
    const matching = narrationEvents.filter((n) => {
      const at = new Date(n.at).getTime()
      return at >= startMs && (endMs === null || at < endMs)
    })
    if (matching.length) {
      messages[messageIndex].narration = matching.map(({ agent, time, text }) => ({ agent, time, text }))
    }
  }

  return Response.json({ messages })
}
