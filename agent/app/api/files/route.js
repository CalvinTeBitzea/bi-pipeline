// WHAT THIS FILE IS, IN BUSINESS TERMS
// -------------------------------------
// A tiny endpoint (`GET /api/files`) that lists every file that's ever been
// uploaded to this Anthropic account through the Files API — e.g. a schema
// spreadsheet a user attached to a chat message. It's mostly used for
// debugging/inspection rather than being a core feature the end user directly
// interacts with.
//
// CONCEPT: The Files API is separate from a session's own workspace
// -------------------------------------------------------------------------
// This is a different storage mechanism from the per-session file system the
// agents write dashboard_spec.json etc. into (see session-files/route.js).
// Files uploaded here are account-level objects — persistent, addressable by
// ID, and attachable to any future message — closer to "your Google Drive"
// than "this specific conversation's scratch folder."
import Anthropic from '@anthropic-ai/sdk'

export async function GET() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    // 'files-api-2025-04-14' is a beta flag — Anthropic gates newer/experimental
    // API surface behind these opt-in strings so they can change behavior
    // before it's a permanent, stable part of the API.
    const result = await client.beta.files.list({ betas: ['files-api-2025-04-14'] })
    return Response.json({ files: result.data ?? [] })
  } catch (err) {
    return Response.json({ files: [], error: err?.message ?? String(err) })
  }
}
