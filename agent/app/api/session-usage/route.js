import Anthropic from '@anthropic-ai/sdk'

const DEFAULT_SESSION_ID = process.env.REFERENCE_SESSION_ID || 'sesn_01VqZTqWVuuLBdayQE34m1t5'
const BETA               = 'managed-agents-2026-04-01'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const SESSION_ID = searchParams.get('sessionId') || DEFAULT_SESSION_ID
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  try {
    const session = await client.beta.sessions.retrieve(SESSION_ID, { betas: [BETA] })
    return Response.json({ usage: session.usage ?? null })
  } catch (err) {
    return Response.json({ usage: null, error: err.message }, { status: 500 })
  }
}
