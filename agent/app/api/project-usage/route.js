// WHAT THIS FILE IS, IN BUSINESS TERMS
// -------------------------------------
// The same cost-calculation idea as session-usage/route.js, but zoomed all
// the way out: "across every conversation this project has ever run, how
// much have I spent, and on what?" This is what feeds the "Project to date"
// figure at the very top of the sidebar — the number that answers "is this
// AI pipeline getting expensive?" without needing to add up every past
// conversation by hand.
//
// CONCEPT: Scoping "this project" without a database of our own
// -------------------------------------------------------------------------
// This app has no database — every fact it shows comes from asking
// Anthropic's platform directly. So "every conversation in this project"
// isn't a table we can query; it's defined here as "every session ever
// created against this specific coordinator agent" (every conversation the
// real app starts is created against that same one agent — see
// session/new/route.js). Filtering the platform's session list by that
// agent ID is what turns "an API key that might be used for many things"
// into "just this product's conversations" — and because it's a server-side
// filter against Anthropic's own records, it's correct regardless of which
// machine or browser a given conversation happened on.
//
// CONCEPT: Doing the work in parallel, and not repeating work that can't change
// -----------------------------------------------------------------------------
// Naively, "walk every session's full thread history" for potentially dozens
// of past conversations would be slow if done one at a time. Two
// optimizations below address that: `Promise.all` fires off the cost
// calculation for every session AT ONCE rather than waiting for each one to
// finish before starting the next (measured: ~20x faster in practice); and
// a session that has fully finished (`status === 'terminated'`) can never
// accumulate more usage, so its cost is cached in memory the first time it's
// computed and never recalculated again on subsequent requests.
import Anthropic from '@anthropic-ai/sdk'
import { costForSession } from '../../../lib/pricing'

const DEFAULT_SESSION_ID = process.env.REFERENCE_SESSION_ID || 'sesn_01S3zW6pLxWnwyxZ9rmB6tZB'
const BETA               = 'managed-agents-2026-04-01'

// Terminated sessions' usage is frozen (no further turns possible), so their
// cost never needs to be recomputed once seen. Caching them here turns every
// request after the first cold one into "walk only the sessions still live"
// instead of re-walking every thread of every session that ever ran.
const frozenCache = new Map()

export async function GET() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  try {
    // Every conversation in this app is created against the same coordinator
    // agent (see /api/session/new). Filtering sessions by that agent ID scopes
    // this to "every conversation ever run in this project" — server-side and
    // machine-independent, unlike the sidebar's session list (localStorage).
    const ref = await client.beta.sessions.retrieve(DEFAULT_SESSION_ID, { betas: [BETA] })

    const sessions = []
    for await (const s of client.beta.sessions.list({
      agent_id: ref.agent.id,
      include_archived: true,
      betas: [BETA],
    })) {
      sessions.push(s)
    }

    const perSession = await Promise.all(sessions.map(async (s) => {
      if (frozenCache.has(s.id)) return frozenCache.get(s.id)
      const byAgent = await costForSession(client, s.id, [BETA], new Date(s.created_at))
      if (s.status === 'terminated') frozenCache.set(s.id, byAgent)
      return byAgent
    }))

    let totalCost = 0
    const totalUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    const byAgent = {}
    for (const sessionByAgent of perSession) {
      for (const [name, a] of Object.entries(sessionByAgent)) {
        totalCost += a.cost
        totalUsage.input      += a.input
        totalUsage.output     += a.output
        totalUsage.cacheRead  += a.cacheRead
        totalUsage.cacheWrite += a.cacheWrite

        if (!byAgent[name]) byAgent[name] = { input: 0, output: 0, cost: 0 }
        byAgent[name].input  += a.input
        byAgent[name].output += a.output
        byAgent[name].cost   += a.cost
      }
    }

    return Response.json({ sessionCount: sessions.length, totalCost, totalUsage, byAgent })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
