// WHAT THIS FILE IS, IN BUSINESS TERMS
// -------------------------------------
// Returns the list of every conversation in this project — the data that
// fills the sidebar's "Conversations" list. Until now, that list lived only
// in each browser's own localStorage (see ChatInterface.jsx), which is why
// opening the app on a different computer showed a different, seemingly
// unsynced list: a work laptop's browser has never heard of a conversation
// only ever opened on a personal Mac. This endpoint fixes that by treating
// Anthropic's own session records — which already exist on their servers,
// regardless of which device created them — as the single source of truth,
// the same fix already applied to project-usage/route.js for the cost
// total.
//
// Each session's nickname and pinned status are also stored SERVER-SIDE now
// (in the session's own `title` and `metadata` fields — see
// session-update/route.js, the endpoint that writes them), rather than only
// in localStorage — so a rename or pin made on one device is visible from
// any other device that loads this list.
import Anthropic from '@anthropic-ai/sdk'

const DEFAULT_SESSION_ID = process.env.REFERENCE_SESSION_ID || 'sesn_01S3zW6pLxWnwyxZ9rmB6tZB'
const BETA               = 'managed-agents-2026-04-01'

export async function GET() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  try {
    // Same "find the coordinator agent, then list every session created
    // against it" technique as project-usage/route.js — this is what scopes
    // the list to "every conversation in THIS project," server-side, rather
    // than whatever one browser's localStorage happens to remember.
    const ref = await client.beta.sessions.retrieve(DEFAULT_SESSION_ID, { betas: [BETA] })

    const sessions = []
    for await (const s of client.beta.sessions.list({
      agent_id: ref.agent.id,
      include_archived: true,
      betas: [BETA],
    })) {
      // Exclude internal dev/QA sessions (created by the verify_*.py scripts
      // in agent-configs/, which title themselves "verify_live smoke test" /
      // "verify_memory <label>") — these are real sessions under this same
      // coordinator agent, but they're development artifacts, not real
      // conversations, and shouldn't clutter a real user's sidebar.
      if ((s.title ?? '').startsWith('verify_')) continue

      sessions.push({
        id: s.id,
        name: s.title ?? '',
        createdAt: s.created_at,
        pinned: s.metadata?.pinned === '1',
        fileStatus: s.metadata?.hasSpec != null
          ? { hasSpec: s.metadata.hasSpec === '1', hasModel: s.metadata?.hasModel === '1' }
          : null,
      })
    }
    // `sessions.list()` defaults to newest-first — matches the ordering
    // ChatInterface.jsx's sessionFallbackName already assumes (oldest
    // session = position 1 = "Original").

    return Response.json({ sessions })
  } catch (err) {
    return Response.json({ sessions: [], error: err.message }, { status: 500 })
  }
}
