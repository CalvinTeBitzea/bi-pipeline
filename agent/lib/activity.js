// WHAT THIS FILE IS, IN BUSINESS TERMS
// -------------------------------------
// A tiny translation layer: it turns raw, technical events from the AI
// platform ("tool_use, name=write, input={file_path: '/mnt/.../foo.json'}")
// into a one-line, plain-English sentence a non-technical user can read at a
// glance ("write foo.json"). This is exactly what shows up in the collapsible
// "N steps" narration trail under each agent reply.
//
// Shared between the live SSE proxy (app/api/chat/route.js) and the history
// reconstruction endpoint (app/api/session-history/route.js) so both render
// the same narration summary for a validate_ir result or a subagent tool call.
// Sharing this logic in one place, rather than duplicating it in both files,
// guarantees the live view and the "reload the page later" view always agree
// on how to describe the same event.

// Turns the raw JSON result of a validate_ir tool call into one short phrase
// — the difference between a customer seeing a wall of JSON error codes and
// seeing "invalid (3 issues)" or simply "valid."
export function summarizeValidateResult(parsed) {
  if (!parsed) return 'no result'
  if (parsed.error) return `error: ${String(parsed.error).split('\n')[0].slice(0, 120)}`
  if (parsed.valid) return 'valid'
  // Different validation stages (schema ingestion, "gate 1," "gate 3" — see
  // builder/agents/pbip_builder.py for what these gates actually check)
  // each report their own list of problems; add them up into one count
  // rather than showing three separate, more technical numbers.
  const issueCount =
    (parsed.ingest_issues?.length ?? 0) +
    (parsed.gate1?.errors?.length ?? 0) +
    (parsed.gate3?.issues?.length ?? 0)
  return `invalid (${issueCount} issue${issueCount === 1 ? '' : 's'})`
}

// Turns any built-in file/search tool call into a short, readable action
// phrase. Note this is describing what the AGENT DID, not what it's about to
// do — these are past-tense status lines in a running log, similar to a
// build system printing "compiling foo.js" as it works through a job.
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
