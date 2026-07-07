// WHAT THIS FILE IS, IN BUSINESS TERMS
// -------------------------------------
// Runs whenever a user clicks "New conversation" (or the "rerun" retry
// button) in the chat UI. It starts a fresh, empty conversation — with no
// memory of anything said in any other conversation — but built from the
// exact same agent team and settings as every other conversation in the app.
//
// CONCEPT: Cloning configuration from a "reference session" instead of
// hardcoding it here
// -------------------------------------------------------------------------
// Rather than this file itself deciding "use agent X, environment Y," it
// looks up an already-existing session (the REFERENCE_SESSION_ID) and copies
// its `agent` and `environment_id` fields. This means if the coordinator
// agent is ever swapped for a new one (a new deployment, a different
// version), only that one reference session's pointer needs to change —
// this file, and the behavior of every "New conversation" click, updates
// automatically without a code change.
//
// CONCEPT: Attaching the shared memory store at BIRTH, not later
// -------------------------------------------------------------------------
// A Memory Store (see agent-configs/verify_memory.py for the full concept)
// has to be attached to a session as a "resource" at the moment
// `sessions.create()` is called — it can't be bolted on partway through a
// conversation. That's why this is the ONE place in the whole app that
// wires up the "lessons learned" memory store: every new conversation, from
// its very first message, already has read/write access to everything past
// conversations have learned.
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

  // The actual "start a new, empty conversation" call — everything above
  // this point was just gathering the ingredients (which agent, which
  // sandbox environment, which shared memory) to pass into it.
  const newSession = await client.beta.sessions.create({
    agent:          ref.agent.id,
    environment_id: ref.environment_id,
    ...(resources ? { resources } : {}),
    betas:          [BETA],
  })

  return Response.json({ sessionId: newSession.id, createdAt: newSession.created_at })
}
