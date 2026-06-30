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
