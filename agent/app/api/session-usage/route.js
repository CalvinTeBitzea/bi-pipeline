import Anthropic from '@anthropic-ai/sdk'
import { costFor } from '../../../lib/pricing'

const DEFAULT_SESSION_ID = process.env.REFERENCE_SESSION_ID || 'sesn_01S3zW6pLxWnwyxZ9rmB6tZB'
const BETA               = 'managed-agents-2026-04-01'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const SESSION_ID = searchParams.get('sessionId') || DEFAULT_SESSION_ID
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  try {
    const session = await client.beta.sessions.retrieve(SESSION_ID, { betas: [BETA] })

    // updated_at tracks the last processed event, so this is the real wall-clock
    // span of the conversation — unlike session.stats.duration_seconds, which
    // keeps counting elapsed idle time until the session is archived.
    const elapsedSeconds = (new Date(session.updated_at) - new Date(session.created_at)) / 1000

    // Each subagent thread reports its own cumulative usage + the exact model
    // snapshot it ran with — no need to walk individual model-request events.
    const byAgent = {}
    for await (const thread of client.beta.sessions.threads.list(SESSION_ID, { betas: [BETA] })) {
      const name  = thread.parent_thread_id === null ? 'coordinator' : (thread.agent?.name ?? 'subagent')
      const model = thread.agent?.model?.id ?? 'claude-opus-4-8'
      const u = thread.usage
      if (!u) continue

      const usage = {
        input:      u.input_tokens ?? 0,
        output:     u.output_tokens ?? 0,
        cacheRead:  u.cache_read_input_tokens ?? 0,
        cacheWrite: (u.cache_creation?.ephemeral_5m_input_tokens ?? 0) + (u.cache_creation?.ephemeral_1h_input_tokens ?? 0),
      }

      if (!byAgent[name]) byAgent[name] = { model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
      byAgent[name].input      += usage.input
      byAgent[name].output     += usage.output
      byAgent[name].cacheRead  += usage.cacheRead
      byAgent[name].cacheWrite += usage.cacheWrite
      byAgent[name].cost       += costFor(usage, model)
    }
    const totalCost = Object.values(byAgent).reduce((sum, a) => sum + a.cost, 0)

    return Response.json({
      usage: session.usage ?? null,
      elapsedSeconds,
      cost: { total: totalCost, byAgent },
    })
  } catch (err) {
    return Response.json({ usage: null, error: err.message }, { status: 500 })
  }
}
