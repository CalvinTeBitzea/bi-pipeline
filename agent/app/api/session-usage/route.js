// WHAT THIS FILE IS, IN BUSINESS TERMS
// -------------------------------------
// Answers one question for a single conversation: "how long did this take,
// and how much did it cost in real dollars?" This is what feeds the "This
// conversation" figures in the sidebar's always-visible usage strip.
//
// CONCEPT: Cost isn't stored anywhere — it has to be CALCULATED
// -------------------------------------------------------------------------
// The platform tracks and bills by TOKENS (roughly: word-fragments an AI
// model reads or writes), not dollars — dollar cost depends on which MODEL
// did the work, since different models have different per-token prices (see
// lib/pricing.js). Because this pipeline deliberately uses a cheaper model
// for some stages (bi-planner/bi-design) and a pricier one for others
// (coordinator/bi-authoring — see lib/pricing.js's AGENT_MODEL mapping),
// there's no single "tokens x one price" formula for a whole conversation —
// each agent's token usage has to be priced at ITS OWN model's rate, then
// summed. That per-agent breakdown is exactly what `costForSession` computes.
import Anthropic from '@anthropic-ai/sdk'
import { costForSession } from '../../../lib/pricing'

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

    // The actual per-agent-role cost breakdown — see lib/pricing.js's
    // costForSession for how this walks every subagent's own thread usage
    // and prices each one at its own model's rate.
    const byAgent = await costForSession(client, SESSION_ID, [BETA], new Date(session.created_at))
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
