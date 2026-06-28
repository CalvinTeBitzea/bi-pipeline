import Anthropic from '@anthropic-ai/sdk'

const DEFAULT_SESSION_ID = process.env.REFERENCE_SESSION_ID || 'sesn_01VqZTqWVuuLBdayQE34m1t5'
const BETA               = 'managed-agents-2026-04-01'

export async function POST(request) {
  const body    = await request.json().catch(() => ({}))
  const refId   = body.refSessionId || DEFAULT_SESSION_ID
  const client  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // Borrow agent + environment from the reference session
  const ref = await client.beta.sessions.retrieve(refId, { betas: [BETA] })

  const newSession = await client.beta.sessions.create({
    agent:          ref.agent.id,
    environment_id: ref.environment_id,
    betas:          [BETA],
  })

  return Response.json({ sessionId: newSession.id, createdAt: newSession.created_at })
}
