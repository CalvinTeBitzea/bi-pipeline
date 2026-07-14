// WHAT THIS FILE IS, IN BUSINESS TERMS
// -------------------------------------
// This is the "before you start" form the user fills in above the chat box:
// paste in your data model (which tables/columns exist), describe the
// business context, and optionally attach files. It's the equivalent of an
// intake form a consultant would hand a new client before the first meeting
// — the AI planning agent's very first message (see bi-planner.agent.yaml)
// is written assuming it will receive exactly this shape of information.
//
// CONCEPT: 'use client' — code that must run in the USER's browser
// -------------------------------------------------------------------------
// Next.js, by default, tries to run as much of a page's code as possible on
// the SERVER (faster initial load, less code sent to the browser). But
// anything that needs live interactivity — reacting to typing, drag-and-drop,
// button clicks — has to run in the browser itself. The `'use client'`
// directive at the top of this file is how you opt a component OUT of the
// server-only default and mark it as needing to run client-side. Every file
// in this app with real interactivity (this one, ChatInterface.jsx) starts
// this way.
'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { gsap } from 'gsap'
import { Upload, X, FileText, AlertCircle } from 'lucide-react'

// File types we can't read as plain text in the browser (they're compressed/
// binary formats — an Excel file isn't just text, for instance). These still
// get uploaded and handed to the agent, which has its own way of extracting
// text from them server-side; we just can't preview/estimate their token
// cost here in the browser the way we can for a plain-text file.
const BINARY_EXTENSIONS = new Set(['xlsx', 'xls', 'docx', 'doc', 'pdf', 'pptx', 'ppt'])

function getExt(f) { return f.split('.').pop().toLowerCase() }

// CONCEPT: FileReader — reading a file the user picked, entirely in-browser
// -------------------------------------------------------------------------
// When a user attaches a file, the browser hands this code a `File` object
// that's really just a reference/handle — the actual bytes aren't
// automatically loaded into memory as text. `FileReader` is the browser's
// built-in API for actually reading those bytes; `readAsText` decodes them
// as a string, which is what lets this component show a live "~2.3k tokens"
// estimate before the file is ever sent anywhere.
async function readUploadedFile(file) {
  const ext = getExt(file.name)
  const id  = `${file.name}-${file.size}`
  if (BINARY_EXTENSIONS.has(ext)) return { id, name: file.name, ext, content: null, binary: true }
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload  = (e) => resolve({ id, name: file.name, ext, content: e.target.result, binary: false })
    r.onerror = ()  => resolve({ id, name: file.name, ext, content: null, binary: true, readError: true })
    r.readAsText(file)
  })
}

// CONCEPT: "Controlled" form fields — the parent component owns the truth
// -------------------------------------------------------------------------
// Notice this component receives `schema`/`context`/`files` as PROPS (data
// passed down from its parent, ChatInterface.jsx) along with `onSchemaChange`
// etc. callbacks, rather than keeping its own independent copy of what the
// user typed. This is the standard React pattern of a "controlled
// component": the parent is the single source of truth for the data, and
// this component's only job is to display it and report back every keystroke
// or file drop — so ChatInterface.jsx can, for instance, bundle this data
// into the very first message sent to the agent when the user hits send.
export default function SetupPanels({ schema, onSchemaChange, context, onContextChange, sampleRows, onSampleRowsChange, files, onFilesChange }) {
  const wrapRef      = useRef(null)
  const fileInputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  // A one-time entrance animation (fade + slide up) the moment this panel
  // first appears — purely cosmetic polish, unrelated to functionality.
  useEffect(() => {
    gsap.from(wrapRef.current, { opacity: 0, y: 10, duration: 0.4, ease: 'power2.out' })
  }, [])

  const handleFiles = useCallback(async (rawFiles) => {
    // Read every newly-added file in parallel (Promise.all), then merge them
    // into the existing file list — de-duplicating by name+size so dragging
    // the same file in twice doesn't create two entries.
    const incoming = await Promise.all(Array.from(rawFiles).map(readUploadedFile))
    onFilesChange((prev) => {
      const seen = new Set(prev.map((f) => f.id))
      return [...prev, ...incoming.filter((f) => !seen.has(f.id))]
    })
  }, [onFilesChange])

  const onDrop = (e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }
  const removeFile = (id) => onFilesChange((prev) => prev.filter((f) => f.id !== id))

  return (
    <div ref={wrapRef} className="flex flex-col gap-2 w-full">

      {/* Schema — the user pastes their table/column structure as plain
          text (no need for a real database connection); the planning agent
          is told to treat this as ground truth and never invent columns
          beyond what's listed here. */}
      <div className="border border-ink/15 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 bg-surface/50 border-b border-ink/10">
          <span className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted">Data Model</span>
          {schema.length > 0 && (
            // A rough, client-side "characters ÷ 4" token estimate — cheap
            // and fast, though not exactly how the real model tokenizes
            // text; good enough to warn a user their input is getting large
            // before they ever send it (and before it costs real money).
            <span className="font-mono text-[9px] text-muted">~{Math.round(schema.length / 4).toLocaleString()} tok</span>
          )}
        </div>
        <textarea
          value={schema}
          onChange={(e) => onSchemaChange(e.target.value)}
          placeholder={"fact_orders (order_id, date, customer_id, product_id, qty, price)\ndim_customers (customer_id, name, segment)\n\nfact_orders.customer_id → dim_customers.customer_id"}
          className="w-full min-h-[96px] font-mono text-[12px] leading-relaxed text-ink bg-offwhite/50 outline-none resize-none px-3 py-2.5 placeholder:text-muted/75"
          spellCheck={false}
        />
      </div>

      {/* Sample Rows — optional real example rows for the columns the
          planning agent will need to filter/compare on (e.g. a Status
          column's actual values). Purely additive: nothing here is
          required, but giving real values upfront lets the planning agent
          skip asking a follow-up question for any column these rows
          already cover, instead of guessing or blocking on a question. */}
      <div className="border border-ink/15 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 bg-surface/50 border-b border-ink/10">
          <span className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted">Sample Rows (optional)</span>
          {sampleRows.length > 0 && (
            <span className="font-mono text-[9px] text-muted">~{Math.round(sampleRows.length / 4).toLocaleString()} tok</span>
          )}
        </div>
        <textarea
          value={sampleRows}
          onChange={(e) => onSampleRowsChange(e.target.value)}
          placeholder={"2-3 real rows per table help the agent avoid guessing at\ncategory/status values, e.g.:\n\norder_id, date, customer_id, status\n1001, 2026-06-01, 42, Closed\n1002, 2026-06-03, 17, Open"}
          className="w-full min-h-[72px] font-mono text-[12px] leading-relaxed text-ink bg-offwhite/50 outline-none resize-none px-3 py-2.5 placeholder:text-muted/75"
          spellCheck={false}
        />
      </div>

      {/* Context + file drop — free-text business background, plus a
          drag-and-drop zone for supporting documents (specs, sample
          exports, etc). */}
      <div
        className={`border rounded-lg overflow-hidden transition-colors duration-150 ${
          dragging ? 'border-red/40 bg-red/5' : 'border-ink/15'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="flex items-center justify-between px-3 py-1.5 bg-surface/50 border-b border-ink/10">
          <span className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted">Business Context</span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 font-mono text-[9px] tracking-[0.1em] uppercase text-muted hover:text-red transition-colors"
          >
            <Upload size={9} />
            Attach
          </button>
          {/* A hidden native file-picker input — clicking the visible
              "Attach" button above just forwards the click to this, since
              native file inputs are hard to style directly. */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,.csv,.json,.md,.xlsx,.xls,.docx,.doc,.pdf,.tsv,.sql,.yaml,.yml"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        <textarea
          value={context}
          onChange={(e) => onContextChange(e.target.value)}
          placeholder="Who uses this? What decisions should it support?"
          className={`w-full min-h-[68px] font-grotesk text-[13px] leading-relaxed text-ink bg-offwhite/50 outline-none resize-none px-3 py-2.5 placeholder:text-muted/80 transition-opacity ${dragging ? 'opacity-20' : ''}`}
        />

        {files.length > 0 && (
          <div className="border-t border-ink/10 px-3 py-2 flex flex-wrap gap-1.5">
            {files.map((f) => {
              const tokEst = !f.binary && !f.readError && f.content
                ? Math.round(f.content.length / 4)
                : null
              return (
                <div key={f.id} className="flex items-center gap-1 bg-surface border border-ink/10 rounded px-1.5 py-0.5">
                  {f.binary || f.readError
                    ? <AlertCircle size={9} className="text-red flex-shrink-0" />
                    : <FileText size={9} className="text-muted flex-shrink-0" />}
                  <span className="font-mono text-[9px] text-ink max-w-[80px] truncate">{f.name}</span>
                  {tokEst !== null && (
                    <span className={`font-mono text-[8px] ${tokEst > 10000 ? 'text-red/80' : 'text-muted/65'}`}>
                      ~{tokEst >= 1000 ? `${(tokEst / 1000).toFixed(1)}k` : tokEst}tok
                    </span>
                  )}
                  <button onClick={() => removeFile(f.id)} className="text-muted/65 hover:text-red ml-0.5">
                    <X size={9} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
