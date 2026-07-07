// WHAT THIS FILE IS, IN BUSINESS TERMS
// -------------------------------------
// Powers the "Files" panel in the chat UI — the list of dashboard_spec.json,
// semantic_model.json, wireframe.html etc. the agent team has produced for
// THIS conversation, plus every earlier draft of each, so a user can see how
// a file evolved across revision rounds (e.g. bi-authoring flags an issue,
// bi-design fixes it and rewrites the file — this endpoint lets you see both
// the before and the after).
//
// CONCEPT: There's no dedicated "list files" API — we reconstruct it
// -------------------------------------------------------------------------
// The Managed Agents platform doesn't expose a simple "show me the current
// contents of the session's workspace" endpoint. What it DOES expose is the
// full, ordered history of every event that happened in the session —
// including every raw `write`/`edit` tool call the agents made. So this
// route works like a forensic accountant: it replays that entire event log
// from the beginning, in order, and manually re-derives "what does each file
// look like right now" (and every version it passed through) purely from
// the sequence of write/edit actions. This is the same idea as reconstructing
// a document's final state by replaying its full edit history rather than
// asking for "the current version" directly, which isn't offered here.
import Anthropic from '@anthropic-ai/sdk'

const DEFAULT_SESSION_ID = process.env.REFERENCE_SESSION_ID || 'sesn_01S3zW6pLxWnwyxZ9rmB6tZB'
const BETA               = 'managed-agents-2026-04-01'

// File extensions the agent is expected to write as outputs
const ALLOWED_EXTS = new Set(['json', 'md', 'html', 'txt', 'csv'])

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const SESSION_ID = searchParams.get('sessionId') || DEFAULT_SESSION_ID
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const events = []
  try {
    // Pull the ENTIRE event history for this conversation — every message,
    // every tool call, from the very start. For a long-running session this
    // could be a lot of events, but it's the only way to answer "what files
    // exist and what do they contain."
    for await (const event of client.beta.sessions.events.list(SESSION_ID, { betas: [BETA] })) {
      events.push(event)
    }
  } catch (err) {
    return Response.json({ error: err.message, files: [] }, { status: 500 })
  }

  // Sort chronologically so writes and edits apply in the correct order
  events.sort((a, b) => new Date(a.processed_at) - new Date(b.processed_at))

  // Track versioned history per file path.
  // Each 'write' event to a path that already has content starts a new version.
  // 'edit' events patch the current (latest) version in place.
  //
  // Result shape per path:
  //   versions: [{ content, writtenAt, versionNum }]  (chronological, earliest first)
  //   The last entry is the "current" version; everything before it is archived.
  const fileVersions = {} // path → { versions: [...] }

  for (const event of events) {
    if (event.type !== 'agent.tool_use') continue

    const input = event.input || {}
    const path  = input.file_path || ''
    if (!path) continue

    // Accept files from the session workspace with recognised extensions.
    // We cast a wider net than /mnt/session/outputs/ so we catch whatever
    // path the agent writes to, as long as the extension is in the allowed set.
    const ext = path.split('.').pop().toLowerCase()
    if (!ALLOWED_EXTS.has(ext)) continue
    // Skip hidden files and OS pseudo-paths
    if (path.includes('/.') || path.startsWith('/proc/') || path.startsWith('/sys/')) continue

    if (event.name === 'write' && input.content != null) {
      // A `write` call replaces a file wholesale — treat it as a brand new
      // version, keeping every prior version around rather than discarding it.
      if (!fileVersions[path]) {
        fileVersions[path] = { versions: [] }
      }
      const { versions } = fileVersions[path]
      versions.push({
        content:    input.content,
        writtenAt:  event.processed_at ?? new Date().toISOString(),
        versionNum: versions.length + 1,
      })
    } else if (event.name === 'edit') {
      // An `edit` call is a find-and-replace against whatever the CURRENT
      // latest version is — we have to actually perform that same
      // find-and-replace ourselves here (`.replace`/`.split().join()`) to
      // keep our reconstructed copy in sync with what really happened on
      // the agent's side.
      const state = fileVersions[path]
      if (!state?.versions?.length) continue
      const latest = state.versions[state.versions.length - 1]
      const oldStr = input.old_string ?? ''
      const newStr = input.new_string ?? ''
      if (!oldStr) continue
      let newContent = latest.content
      if (input.replace_all) {
        newContent = newContent.split(oldStr).join(newStr)
      } else {
        newContent = newContent.replace(oldStr, newStr)
      }
      state.versions[state.versions.length - 1] = { ...latest, content: newContent }
    }
  }

  // Build the response: latest version of each file + archived older versions
  const files = Object.entries(fileVersions).map(([path, { versions }]) => {
    const name    = path.split('/').pop()
    const latest  = versions[versions.length - 1]
    const archive = versions.slice(0, -1).reverse() // most recent archived first

    return {
      name,
      content:   latest.content,
      version:   latest.versionNum,
      writtenAt: latest.writtenAt,
      archive:   archive.map(v => ({
        content:   v.content,
        version:   v.versionNum,
        writtenAt: v.writtenAt,
      })),
    }
  })

  return Response.json({ files })
}
