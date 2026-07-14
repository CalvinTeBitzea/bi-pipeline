// WHAT THIS FILE IS, IN BUSINESS TERMS
// -------------------------------------
// The client-side half of "connect the agent to your report folder": once a
// user picks a local folder, this is what actually writes the built pages
// and merges the built measures into it directly from the browser — no zip,
// no manual copy-paste. It's the automatic alternative to downloading the
// zip and following the README by hand; that manual path still exists and
// still works exactly as before (see ChatInterface.jsx's buildPbip) for
// anyone on a browser that doesn't support this, or who just prefers it.
//
// CONCEPT: The File System Access API — a website reading/writing YOUR files
// -------------------------------------------------------------------------
// Normally a website has zero access to your computer's filesystem — that's
// a deliberate, fundamental browser security boundary. The File System
// Access API is the narrow, explicit exception: `window.showDirectoryPicker()`
// opens the browser's own native folder picker, and if the user selects a
// folder, the SITE receives a `FileSystemDirectoryHandle` scoped to exactly
// that folder (and its contents) — nothing outside it, and only after the
// user's explicit, one-time consent via that native dialog. As of today,
// this is Chrome/Edge only — Safari and Firefox don't implement it, so
// every function here is skipped entirely (see `isSupported()`) on those
// browsers, falling back to the zip-download path with no error or broken
// UI.
//
// CONCEPT: Why this only ever MERGES, never overwrites wholesale
// -------------------------------------------------------------------------
// The user's report/model folders already exist, built by Power BI Desktop
// itself, with real data-source connections this pipeline has no way to
// recreate and no business touching. Every write in this file either (a)
// creates a brand-new file our own build produced (a new page/visual — safe,
// nothing else owns that path) or (b) merges additively into a file that
// already exists (pages.json's page list, a table's measure blocks) rather
// than replacing its contents outright. Rebuilding the same report twice
// should never duplicate a measure or drop an unrelated page.

const DB_NAME = 'bi_agent_fs'
const STORE_NAME = 'handles'
const HANDLE_KEY = 'reportFolder'

export function isSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

// --- IndexedDB persistence -------------------------------------------------
// A FileSystemDirectoryHandle is "structured-cloneable," meaning it can be
// stored in IndexedDB (unlike, say, localStorage, which only holds strings)
// — this is what lets the connected folder survive a page reload instead of
// requiring the user to re-pick it every single time they open the app.
// Re-opening the app will still typically need one quick re-grant of
// permission (a browser security measure — a stored handle doesn't imply
// standing access forever), handled by `ensurePermission` below.

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function saveHandle(handle) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadSavedHandle() {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function clearSavedHandle() {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(HANDLE_KEY)
  } catch {}
}

// Must be called synchronously from within a real user click/tap — browsers
// refuse to show either the picker or a permission prompt otherwise, as a
// defense against a page silently trying to grab filesystem access on load.
export async function pickReportFolder() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
  await saveHandle(handle)
  return handle
}

// Re-checks (and if needed, re-requests) permission on a previously-saved
// handle. `requestPermission` also needs a user gesture, same as the picker
// itself — this is why "reconnect" in the UI has to be a real button click,
// not something fired automatically on page load.
export async function ensurePermission(handle) {
  const opts = { mode: 'readwrite' }
  if ((await handle.queryPermission(opts)) === 'granted') return true
  return (await handle.requestPermission(opts)) === 'granted'
}

async function findReportAndModelDirs(rootHandle) {
  let reportDir = null
  let modelDir = null
  for await (const [name, handle] of rootHandle.entries()) {
    if (handle.kind !== 'directory') continue
    if (name.endsWith('.Report')) reportDir = { name, handle }
    else if (name.endsWith('.SemanticModel')) modelDir = { name, handle }
  }
  return { reportDir, modelDir }
}

async function writeFileAtPath(rootDirHandle, relPath, content) {
  const parts = relPath.split('/')
  const fileName = parts.pop()
  let dir = rootDirHandle
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true })
  }
  const fileHandle = await dir.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
}

async function readFileIfExists(dirHandle, fileName) {
  try {
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: false })
    return await (await fileHandle.getFile()).text()
  } catch {
    return null
  }
}

// pages.json is a shared INDEX (page order + which page opens by default),
// not a page's own content — overwriting it wholesale would silently drop
// any other pages already listed there (from an earlier build, or a page
// the user added by hand in Desktop). This merges our new page names in
// alongside whatever's already listed, the same additive approach
// pbip_builder.py already uses server-side when it DOES have a real
// project path (see _update_pages_json) — here we're just doing the same
// merge on the client, since the server-side build is always run
// statelessly with no visibility into the user's real, already-existing file.
async function mergePagesJson(pagesDirHandle, newContent) {
  const existingText = await readFileIfExists(pagesDirHandle, 'pages.json')
  const incoming = JSON.parse(newContent)
  if (!existingText) {
    await writeFileAtPath(pagesDirHandle, 'pages.json', newContent)
    return
  }
  const existing = JSON.parse(existingText)
  const pageOrder = [...(existing.pageOrder ?? [])]
  for (const name of incoming.pageOrder ?? []) {
    if (!pageOrder.includes(name)) pageOrder.push(name)
  }
  const merged = {
    ...existing,
    pageOrder,
    // Keep whatever was already open by default; only adopt the new value
    // if this project had no active page at all yet.
    activePageName: existing.activePageName || incoming.activePageName,
  }
  await writeFileAtPath(pagesDirHandle, 'pages.json', JSON.stringify(merged, null, 2))
}

// Writes the dedicated `_Measures` table — CREATING it fresh (using the
// full, ready-made TMDL content from the manifest) the first time, or
// MERGING into it on a rebuild if it already exists. Assumes the standard
// PBIP per-object layout (one table's whole definition lives in its own
// file, ending at EOF) — appending at the very end is therefore
// syntactically safe on a merge: nothing else in that file follows the
// table's closing content. On merge, skips (rather than duplicates) any
// measure whose name is already present, so rebuilding the same report
// repeatedly is safe to re-run.
async function writeMeasuresTable(tablesDirHandle, measuresTable) {
  const { name, createContent, measures } = measuresTable
  const fileName = `${name}.tmdl`
  const existingText = await readFileIfExists(tablesDirHandle, fileName)

  if (existingText == null) {
    // No file yet AND nothing to create means the build produced zero
    // measures — genuinely possible (a slicer-only page) but also exactly
    // what happens if measures got silently dropped upstream. Report it
    // explicitly (`empty: true`) rather than returning an indistinguishable
    // "nothing happened" result, so the UI can surface it instead of
    // showing nothing at all.
    if (!createContent) return { created: false, added: [], skipped: [], empty: true }
    await writeFileAtPath(tablesDirHandle, fileName, createContent)
    return { created: true, added: measures.map(m => m.name), skipped: [] }
  }

  const added = []
  const skipped = []
  let appended = ''
  for (const m of measures) {
    // A simple, deliberately loose text check — not a full TMDL parser —
    // matching how the measure's own name literal would appear whether the
    // file quotes it with single or double quotes.
    const already = existingText.includes(`measure '${m.name}'`) || existingText.includes(`measure "${m.name}"`)
    if (already) {
      skipped.push(m.name)
      continue
    }
    appended += `\n${m.block}\n`
    added.push(m.name)
  }

  if (added.length) {
    const newText = existingText.replace(/\n*$/, '\n') + appended
    await writeFileAtPath(tablesDirHandle, fileName, newText)
  }
  return { created: false, added, skipped }
}

// Ensures `refLine` (e.g. "ref table _Measures") exists in the
// SemanticModel's top-level model.tmdl — a .tmdl file on disk in
// definition/tables/ isn't enough on its own; Desktop only loads tables
// listed in this index. Idempotent (checks the line isn't already present
// before adding it, so rebuilding never adds a duplicate ref), and inserts
// immediately before the `ref cultureInfo` line to match the exact
// convention Microsoft's own skill template uses for this same pattern —
// falling back to appending at EOF if that anchor line isn't found for some
// reason, which still produces a valid model.tmdl.
async function ensureModelRef(modelDefinitionDir, refLine) {
  const existingText = await readFileIfExists(modelDefinitionDir, 'model.tmdl')
  if (existingText == null) {
    return { added: false, error: 'model.tmdl not found — could not register the new table' }
  }
  if (existingText.includes(refLine)) {
    return { added: false, error: null }
  }

  const lines = existingText.split('\n')
  const anchorIdx = lines.findIndex(l => l.trim().startsWith('ref cultureInfo'))
  if (anchorIdx === -1) {
    const newText = existingText.replace(/\n*$/, '\n') + `\n${refLine}\n`
    await writeFileAtPath(modelDefinitionDir, 'model.tmdl', newText)
  } else {
    lines.splice(anchorIdx, 0, refLine, '')
    await writeFileAtPath(modelDefinitionDir, 'model.tmdl', lines.join('\n'))
  }
  return { added: true, error: null }
}

// The top-level entry point ChatInterface.jsx calls: given a connected
// root folder handle and the manifest fetched from /api/build-manifest,
// write every page and merge every measure, returning a structured summary
// for the UI to report back to the user (what succeeded, what needs manual
// attention because a table file couldn't be found, etc).
export async function applyManifest(rootHandle, manifest) {
  const ok = await ensurePermission(rootHandle)
  if (!ok) throw new Error('Permission to write to the report folder was not granted.')

  const { reportDir, modelDir } = await findReportAndModelDirs(rootHandle)
  if (!reportDir) {
    throw new Error('No "<Name>.Report" folder found inside the connected folder.')
  }

  const definitionDir = await reportDir.handle.getDirectoryHandle('definition', { create: true })
  const pagesDirHandle = await definitionDir.getDirectoryHandle('pages', { create: true })

  let pagesWritten = 0
  for (const page of manifest.pages ?? []) {
    const rel = page.path.replace(/^definition\/pages\//, '')
    if (rel === 'pages.json') {
      await mergePagesJson(pagesDirHandle, page.content)
    } else {
      await writeFileAtPath(pagesDirHandle, rel, page.content)
    }
    pagesWritten++
  }

  let measuresTableResult = null
  let modelRefResult = null
  // Always attempt this when the manifest carries a measuresTable at all
  // (it always does — see builder/app.py's build_manifest) rather than only
  // when it looks non-empty, so a genuinely empty result is still reported
  // instead of silently skipped (see writeMeasuresTable's `empty` flag).
  const measuresTable = manifest.measuresTable
  if (measuresTable) {
    if (!modelDir) {
      measuresTableResult = { created: false, added: [], skipped: [], notFound: true }
    } else {
      const modelDefinitionDir = await modelDir.handle.getDirectoryHandle('definition', { create: true })
      const tablesDirHandle = await modelDefinitionDir.getDirectoryHandle('tables', { create: true })
      measuresTableResult = await writeMeasuresTable(tablesDirHandle, measuresTable)
      // Only register the ref line if a _Measures table actually exists (or
      // was just created) — registering "ref table _Measures" in model.tmdl
      // when the `empty` bailout above means no such file was ever written
      // would point Desktop at a table that doesn't exist.
      if (manifest.modelRefLine && !measuresTableResult.empty) {
        modelRefResult = await ensureModelRef(modelDefinitionDir, manifest.modelRefLine)
      }
    }
  }

  return {
    reportFolderName: reportDir.name,
    modelFolderName: modelDir?.name ?? null,
    pagesWritten,
    measuresTableName: measuresTable?.name ?? null,
    measuresTableResult,
    modelRefResult,
  }
}
