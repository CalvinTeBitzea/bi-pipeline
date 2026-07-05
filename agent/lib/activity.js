// Shared between the live SSE proxy (app/api/chat/route.js) and the history
// reconstruction endpoint (app/api/session-history/route.js) so both render
// the same activity-log summary for a validate_ir result.
export function summarizeValidateResult(parsed) {
  if (!parsed) return 'no result'
  if (parsed.error) return `error: ${String(parsed.error).split('\n')[0].slice(0, 120)}`
  if (parsed.valid) return 'valid'
  const issueCount =
    (parsed.ingest_issues?.length ?? 0) +
    (parsed.gate1?.errors?.length ?? 0) +
    (parsed.gate3?.issues?.length ?? 0)
  return `invalid (${issueCount} issue${issueCount === 1 ? '' : 's'})`
}
