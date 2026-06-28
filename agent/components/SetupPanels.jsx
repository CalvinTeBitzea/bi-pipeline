'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { gsap } from 'gsap'
import { Upload, X, FileText, AlertCircle } from 'lucide-react'

const BINARY_EXTENSIONS = new Set(['xlsx', 'xls', 'docx', 'doc', 'pdf', 'pptx', 'ppt'])

function getExt(f) { return f.split('.').pop().toLowerCase() }

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

export default function SetupPanels({ schema, onSchemaChange, context, onContextChange, files, onFilesChange }) {
  const wrapRef      = useRef(null)
  const fileInputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    gsap.from(wrapRef.current, { opacity: 0, y: 10, duration: 0.4, ease: 'power2.out' })
  }, [])

  const handleFiles = useCallback(async (rawFiles) => {
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

      {/* Schema */}
      <div className="border border-ink/15 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 bg-surface/50 border-b border-ink/10">
          <span className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted">Data Model</span>
          {schema.length > 0 && (
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

      {/* Context + file drop */}
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
