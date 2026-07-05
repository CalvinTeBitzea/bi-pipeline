// Per-1M-token pricing, USD. Cache read is billed at 10% of input price;
// 5-minute cache write at 1.25x input price (standard Anthropic cache rates).
const SONNET_5_INTRO_CUTOFF = new Date('2026-09-01T00:00:00Z')

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

export function costFor(usage, model, atDate = new Date()) {
  const { input, output } = rateFor(model, atDate)
  return (
    (usage.input * input + usage.cacheRead * input * 0.1 + usage.cacheWrite * input * 1.25) / 1e6 +
    (usage.output * output) / 1e6
  )
}
