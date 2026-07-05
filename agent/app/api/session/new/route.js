import Anthropic from '@anthropic-ai/sdk'

const DEFAULT_SESSION_ID   = process.env.REFERENCE_SESSION_ID || 'sesn_01S3zW6pLxWnwyxZ9rmB6tZB'
const BETA                 = 'managed-agents-2026-04-01'
const LESSONS_MEMORY_STORE = process.env.BI_LESSONS_MEMORY_STORE_ID

export async function POST(request) {
  const body    = await request.json().catch(() => ({}))
  const refId   = body.refSessionId || DEFAULT_SESSION_ID
  const client  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // Borrow agent + environment from the reference session
  const ref = await client.beta.sessions.retrieve(refId, { betas: [BETA] })

  // Memory stores attach once, at session-create time — this is the one place
  // every new conversation gets the shared "lessons learned" store. Skipped
  // gracefully (not a hard failure) if the env var isn't configured yet.
  const resources = LESSONS_MEMORY_STORE
    ? [{
        type:             'memory_store',
        memory_store_id:  LESSONS_MEMORY_STORE,
        access:           'read_write',
        instructions:     'Lessons learned from past dashboard-spec/semantic-model validation failures. Check for relevant entries before generating; write a new one when you fix a non-trivial mistake.',
      }]
    : undefined

  const newSession = await client.beta.sessions.create({
    agent:          ref.agent.id,
    environment_id: ref.environment_id,
    ...(resources ? { resources } : {}),
    betas:          [BETA],
  })

  return Response.json({ sessionId: newSession.id, createdAt: newSession.created_at })
}
