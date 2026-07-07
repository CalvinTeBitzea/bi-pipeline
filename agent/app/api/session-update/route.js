// WHAT THIS FILE IS, IN BUSINESS TERMS
// -------------------------------------
// Handles renaming a conversation, pinning/unpinning it, and recording
// whether its output files are ready to build — the write-side counterpart
// to /api/sessions' read-side list. Whatever this endpoint saves becomes
// visible from ANY device the next time it loads /api/sessions, which is
// what makes renaming/pinning a conversation on one machine show up
// correctly on another.
//
// CONCEPT: Attaching small facts to a session via `title` + `metadata`
// -------------------------------------------------------------------------
// A Managed Agents session has two built-in places to store small,
// arbitrary facts about itself, alongside the real conversation: a
// human-readable `title` string, and a `metadata` dictionary of up to 16
// string key/value pairs. Neither is used by the AI agent itself — they're
// pure bookkeeping, meant for exactly this kind of use: letting the
// surrounding APPLICATION (this chat UI) remember small facts about a
// session without needing a database of its own. `pinned` and file
// readiness aren't naturally string-shaped facts, so they're encoded as the
// strings `"1"`/`"0"` here and decoded back to booleans in
// /api/sessions/route.js.
import Anthropic from '@anthropic-ai/sdk'

const BETA = 'managed-agents-2026-04-01'

export async function POST(request) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const body = await request.json().catch(() => ({}))
  const { sessionId, name, pinned, fileStatus } = body
  if (!sessionId) {
    return Response.json({ error: 'sessionId required' }, { status: 400 })
  }

  // Metadata updates are a PATCH, not a full replace (per the API: set a
  // key to upsert it, omit a key to leave it untouched) — so this only ever
  // needs to send the specific fact that changed, without first fetching
  // and re-sending everything else already stored on the session.
  const metadata = {}
  if (pinned !== undefined) metadata.pinned = pinned ? '1' : '0'
  if (fileStatus !== undefined) {
    metadata.hasSpec  = fileStatus.hasSpec  ? '1' : '0'
    metadata.hasModel = fileStatus.hasModel ? '1' : '0'
  }

  try {
    // The API rejects an empty-string title (minimum length 1) and — unlike
    // metadata keys — doesn't actually clear a title back to unset when
    // sent `null` either. So an empty name is treated as "no title change"
    // here; the chat UI itself avoids ever sending one (see
    // ChatInterface.jsx's rename commit handlers).
    const updated = await client.beta.sessions.update(sessionId, {
      ...(name ? { title: name } : {}),
      ...(Object.keys(metadata).length ? { metadata } : {}),
      betas: [BETA],
    })
    return Response.json({ ok: true, name: updated.title, metadata: updated.metadata })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
