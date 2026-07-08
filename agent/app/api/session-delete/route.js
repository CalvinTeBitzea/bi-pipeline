// WHAT THIS FILE IS, IN BUSINESS TERMS
// -------------------------------------
// Permanently deletes one or more conversations — the backend for the
// sidebar's delete/batch-delete feature. Accepts a LIST of session IDs
// (rather than one at a time) so a multi-select batch delete is a single
// request instead of the browser firing off N separate ones.
//
// This is a genuine, irreversible deletion (not an archive/hide) — once a
// session is deleted here, its entire conversation history is gone from
// Anthropic's platform, not just hidden from this app's sidebar.
import Anthropic from '@anthropic-ai/sdk'

const BETA = 'managed-agents-2026-04-01'

export async function POST(request) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const body = await request.json().catch(() => ({}))
  const ids = Array.isArray(body.sessionIds) ? body.sessionIds : []
  if (!ids.length) {
    return Response.json({ error: 'sessionIds required' }, { status: 400 })
  }

  // Delete every requested session in parallel, and keep going even if one
  // fails (e.g. an already-deleted or invalid ID) — a batch delete
  // shouldn't abandon the whole batch because of one bad entry; the caller
  // gets back exactly which ones succeeded and which didn't.
  const deleted = []
  const errors = []
  await Promise.all(ids.map(async (id) => {
    try {
      await client.beta.sessions.delete(id, { betas: [BETA] })
      deleted.push(id)
    } catch (err) {
      errors.push({ id, message: err.message })
    }
  }))

  return Response.json({ deleted, errors })
}
