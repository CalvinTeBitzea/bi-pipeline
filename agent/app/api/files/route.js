import Anthropic from '@anthropic-ai/sdk'

export async function GET() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const result = await client.beta.files.list({ betas: ['files-api-2025-04-14'] })
    return Response.json({ files: result.data ?? [] })
  } catch (err) {
    return Response.json({ files: [], error: err?.message ?? String(err) })
  }
}
