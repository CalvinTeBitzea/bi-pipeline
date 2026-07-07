// WHAT THIS FILE IS, IN BUSINESS TERMS
// -------------------------------------
// The one place in the whole app that knows "how much does an AI model call
// actually cost in dollars." Every other file that shows a cost figure (the
// per-session and project-total usage endpoints) calls into this file rather
// than doing its own math — a classic "single source of truth" pattern: if
// pricing ever changes, or a new model gets added, there's exactly one place
// to update, instead of hunting through every file that happens to compute a
// dollar figure.
//
// CONCEPT: AI models are billed per TOKEN, not per request or per minute
// -------------------------------------------------------------------------
// A "token" is roughly a word or word-fragment. Providers charge separately
// for INPUT tokens (everything the model reads — your prompt, the
// conversation history, any files) and OUTPUT tokens (everything it
// generates in reply) — and the two are priced very differently (output is
// usually far more expensive per token than input, since generating text is
// more computationally expensive than reading it).
//
// CONCEPT: Prompt caching — why some input tokens are cheaper than others
// -------------------------------------------------------------------------
// If the same large block of text (e.g. a long system prompt, or a
// skill/reference file) is sent to the model again on a follow-up turn,
// the platform can often reuse its previous internal processing of that
// text instead of redoing the work — this is "prompt caching." A
// "cache read" (reusing something already cached) is billed at a steep
// discount (10% of normal input price) since almost no new computation
// happened. A "cache write" (the first time that text is cached, so it CAN
// be reused later) actually costs a bit MORE than a normal read (1.25x) —
// the trade being "pay a small premium now, save a lot on every reuse after
// that." This is why the sidebar shows a "% cached" figure: a high cache-hit
// rate is a proxy for "this conversation is running efficiently," not just a
// curiosity.
// Per-1M-token pricing, USD. Cache read is billed at 10% of input price;
// 5-minute cache write at 1.25x input price (standard Anthropic cache rates).
const SONNET_5_INTRO_CUTOFF = new Date('2026-09-01T00:00:00Z')

// CONCEPT: Introductory pricing that changes on a fixed date
// -------------------------------------------------------------------------
// Sonnet 5 launched with a temporary lower "intro" price that reverts to its
// standard price after a cutoff date — so calculating a past conversation's
// true historical cost requires knowing WHEN it ran, not just which model it
// used. That's why every cost function below threads an `atDate` parameter
// through, instead of always pricing at "today's" rate — a conversation that
// happened before the cutoff should be priced at the cheaper rate it
// actually ran at, even if you're calculating its cost well after the
// cutoff has passed.
function sonnet5Rate(atDate) {
  return atDate < SONNET_5_INTRO_CUTOFF ? { input: 2.00, output: 10.00 } : { input: 3.00, output: 15.00 }
}

const MODEL_RATES = {
  'claude-opus-4-8':  () => ({ input: 5.00, output: 25.00 }),
  'claude-sonnet-5':  sonnet5Rate,
}

// This pipeline's fixed agent -> model mapping (bi-planner.agent.yaml,
// bi-design.agent.yaml, bi-authoring.agent.yaml, coordinator). Update this if
// any agent's model config changes.
//
// CONCEPT: Using different-cost models for different jobs, deliberately
// -------------------------------------------------------------------------
// Not every specialist in this pipeline uses the same underlying AI model.
// bi-planner and bi-design (drafting work, easier to specify and check) run
// on the cheaper Sonnet model; the coordinator and bi-authoring (orchestration
// and quality review — mistakes here are more expensive to catch later) run
// on the pricier, more capable Opus model. This mirrors a very ordinary
// staffing decision: put your more expensive, more experienced reviewer on
// the step where mistakes are costliest, and use a more junior/cheaper
// resource for higher-volume drafting work.
export const AGENT_MODEL = {
  coordinator:    'claude-opus-4-8',
  'bi-planner':   'claude-sonnet-5',
  'bi-design':    'claude-sonnet-5',
  'bi-authoring': 'claude-opus-4-8',
}

export function rateFor(model, atDate = new Date()) {
  const fn = MODEL_RATES[model]
  return fn ? fn(atDate) : { input: 5.00, output: 25.00 } // unknown model: assume worst case
}

// The actual dollar-cost formula for one chunk of usage on one model: each
// token category (plain input, cache-discounted input, cache-write-premium
// input, output) gets its own rate, multiplied out and summed. Dividing by
// 1e6 converts from "price per million tokens" (how providers quote prices)
// down to "price for however many tokens were actually used."
export function costFor(usage, model, atDate = new Date()) {
  const { input, output } = rateFor(model, atDate)
  return (
    (usage.input * input + usage.cacheRead * input * 0.1 + usage.cacheWrite * input * 1.25) / 1e6 +
    (usage.output * output) / 1e6
  )
}

// Each subagent thread reports its own cumulative usage + the exact model
// snapshot it ran with, so a session's total cost is the sum of its threads'
// costs — no need to walk individual model-request events. Shared between
// the per-session and project-total usage endpoints.
//
// CONCEPT: Why cost has to be computed PER SUBAGENT, then added up
// -------------------------------------------------------------------------
// A single conversation isn't "one model doing one job" — it's the
// coordinator plus however many specialist subagents it delegated to, each
// potentially running on a DIFFERENT model at a DIFFERENT price (see
// AGENT_MODEL above). So there's no shortcut of "total tokens x one price" —
// this function has to walk each subagent's own thread, price THAT thread's
// usage at THAT thread's own model rate, and only then add all the
// per-agent dollar figures together into one final total.
export async function costForSession(client, sessionId, betas, atDate = new Date()) {
  const byAgent = {}
  for await (const thread of client.beta.sessions.threads.list(sessionId, { betas })) {
    // A thread with no parent is the coordinator's own top-level
    // conversation; every other thread is a subagent's private
    // conversation with the coordinator, named after that subagent.
    const name  = thread.parent_thread_id === null ? 'coordinator' : (thread.agent?.name ?? 'subagent')
    const model = thread.agent?.model?.id ?? 'claude-opus-4-8'
    const u = thread.usage
    if (!u) continue

    const usage = {
      input:      u.input_tokens ?? 0,
      output:     u.output_tokens ?? 0,
      cacheRead:  u.cache_read_input_tokens ?? 0,
      cacheWrite: (u.cache_creation?.ephemeral_5m_input_tokens ?? 0) + (u.cache_creation?.ephemeral_1h_input_tokens ?? 0),
    }

    if (!byAgent[name]) byAgent[name] = { model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
    byAgent[name].input      += usage.input
    byAgent[name].output     += usage.output
    byAgent[name].cacheRead  += usage.cacheRead
    byAgent[name].cacheWrite += usage.cacheWrite
    byAgent[name].cost       += costFor(usage, model, atDate)
  }
  return byAgent
}
