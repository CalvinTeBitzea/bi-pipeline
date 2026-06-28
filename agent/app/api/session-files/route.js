import Anthropic from '@anthropic-ai/sdk'

const DEFAULT_SESSION_ID = process.env.REFERENCE_SESSION_ID || 'sesn_01VqZTqWVuuLBdayQE34m1t5'
const BETA               = 'managed-agents-2026-04-01'

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

  // Sort chronologically so edits apply in the right order
  events.sort((a, b) => new Date(a.processed_at) - new Date(b.processed_at))

  // Reconstruct final file content by replaying write → edit chains
  const fileContents = {}

  for (const event of events) {
    if (event.type !== 'agent.tool_use') continue
    const input = event.input || {}
    const path  = input.file_path || ''
    if (!path.startsWith('/mnt/session/outputs/')) continue

    if (event.name === 'write' && input.content != null) {
      fileContents[path] = input.content
    } else if (event.name === 'edit' && fileContents[path] != null) {
      const oldStr = input.old_string ?? ''
      const newStr = input.new_string ?? ''
      if (!oldStr) continue
      if (input.replace_all) {
        fileContents[path] = fileContents[path].split(oldStr).join(newStr)
      } else {
        fileContents[path] = fileContents[path].replace(oldStr, newStr)
      }
    }
  }

  const files = Object.entries(fileContents).map(([path, content]) => ({
    name: path.split('/').pop(),
    content,
  }))

  return Response.json({ files })
}
