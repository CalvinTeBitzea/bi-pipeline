import Anthropic from '@anthropic-ai/sdk'

const DEFAULT_SESSION_ID = process.env.REFERENCE_SESSION_ID || 'sesn_01VqZTqWVuuLBdayQE34m1t5'
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

  // Reconstruct turns. Accumulate span.model_request_end token counts per turn.
  const messages = []
  let pendingUser  = null
  let pendingAgent = null
  let turnUsage    = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

  function resetTurnUsage() {
    turnUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  }

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
    } else if (e.type === 'session.thread_status_idle') {
      if (pendingAgent) pendingAgent = { ...pendingAgent, usage: { ...turnUsage } }
      if (pendingUser)  messages.push(pendingUser)
      if (pendingAgent) messages.push(pendingAgent)
      pendingUser  = null
      pendingAgent = null
      resetTurnUsage()
    }
  }

  // Catch anything not closed by a thread_status_idle
  if (pendingUser)  messages.push(pendingUser)
  if (pendingAgent) messages.push({ ...pendingAgent, usage: { ...turnUsage } })

  return Response.json({ messages })
}
