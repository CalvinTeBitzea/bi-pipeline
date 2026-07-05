// Shared between the live SSE proxy (app/api/chat/route.js) and the history
// reconstruction endpoint (app/api/session-history/route.js) so both render
// the same narration summary for a validate_ir result or a subagent tool call.
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

export function summarizeToolCall(name, input) {
  const i = input ?? {}
  switch (name) {
    case 'read':  return `read ${i.file_path ?? ''}`
    case 'write': return `write ${i.file_path ?? ''}`
    case 'edit':  return `edit ${i.file_path ?? ''}`
    case 'glob':  return `glob ${i.pattern ?? ''}`
    case 'grep':  return `grep ${i.pattern ?? ''}${i.path ? ` in ${i.path}` : ''}`
    case 'bash':  return `bash ${(i.command ?? '').split('\n')[0].slice(0, 80)}`
    default:      return name ?? 'tool'
  }
}
