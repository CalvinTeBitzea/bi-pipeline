'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { gsap } from 'gsap'
import { ArrowUp, Download, Paperclip, Plus, Eye, X } from 'lucide-react'
import SetupPanels from './SetupPanels'

const AGENT_LABEL        = 'BI Wireframe Agent'
const DEFAULT_SESSION_ID = process.env.NEXT_PUBLIC_REFERENCE_SESSION_ID || 'sesn_01VqZTqWVuuLBdayQE34m1t5'
const STORAGE_KEY        = 'bi_agent_sessions'

function loadStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return null
}

function saveStorage(sessions, activeId) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions, activeId }))
  } catch {}
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString('en-AU', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function ts() {
  return new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="bg-ink/10 px-1 rounded text-[0.85em]">$1</code>')
    .replace(/\n/g, '<br />')
}

// ─── Messages ────────────────────────────────────────────────────────────────

function AgentMessage({ msg }) {
  const ref = useRef(null)
  useEffect(() => {
    gsap.from(ref.current, { x: -10, opacity: 0, duration: 0.4, ease: 'power3.out' })
  }, [])

  const u     = msg.usage
  const hasU  = u && u.input > 0
  const hit   = hasU && u.cacheRead > 0 ? Math.round(u.cacheRead / u.input * 100) : 0
  const fmtT  = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

  return (
    <div ref={ref} className="flex gap-3">
      <div className="flex-shrink-0 w-5 h-5 rounded-full bg-red mt-0.5" />
      <div className="flex-1 min-w-0">
        <div
          className="font-mono text-[13px] leading-relaxed text-ink"
          dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.text) }}
        />
        {msg.streaming && (
          <span className="inline-block w-1.5 h-3.5 bg-red animate-pulse ml-0.5 align-middle" />
        )}
        <div className="flex items-center gap-2 mt-1.5">
          <p className="font-mono text-[9px] text-muted">{msg.time}</p>
          {hasU && (
            <p className="font-mono text-[9px] text-muted/60">
              {fmtT(u.input)}↓ {fmtT(u.output)}↑{hit > 0 ? ` · ${hit}% cached` : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function UserMessage({ msg }) {
  const ref = useRef(null)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    gsap.from(ref.current, { x: 10, opacity: 0, duration: 0.3, ease: 'power3.out' })
  }, [])

  const isStructured = msg.text.startsWith("I'm providing my data model")

  return (
    <div ref={ref} className="flex justify-end">
      <div className="max-w-[75%]">
        <div
          className={`bg-ink text-paper rounded-2xl rounded-tr-sm px-4 py-3 ${isStructured ? 'cursor-pointer' : ''}`}
          onClick={() => isStructured && setExpanded((v) => !v)}
        >
          <p className="font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
            {isStructured && !expanded
              ? <span>
                  <span className="text-red/95">[ Schema + context ]</span>
                  <br />
                  <span className="text-paper/55 text-[10px]">tap to expand</span>
                </span>
              : msg.text}
          </p>
        </div>
        <p className="font-mono text-[9px] text-muted mt-1 text-right">{msg.time}</p>
      </div>
    </div>
  )
}

function CompactionMarker({ msg }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 h-px bg-ink/10" />
      <span className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted/60 whitespace-nowrap">
        context compacted · {msg.time}
      </span>
      <div className="flex-1 h-px bg-ink/10" />
    </div>
  )
}

function ThinkingBubble({ hint }) {
  const ref = useRef(null)
  useEffect(() => {
    gsap.from(ref.current, { x: -10, opacity: 0, duration: 0.3, ease: 'power3.out' })
  }, [])

  return (
    <div ref={ref} className="flex gap-3">
      <div className="flex-shrink-0 w-5 h-5 rounded-full bg-red/30 mt-0.5 animate-pulse" />
      <div className="flex items-center gap-2 py-0.5">
        <span className="font-mono text-[10px] tracking-widest text-muted uppercase">
          {hint === 'tool' ? 'Using tool' : 'Thinking'}
        </span>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1 h-1 rounded-full bg-red/50"
            style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function downloadBlob(name, content) {
  const ext  = name.split('.').pop().toLowerCase()
  const mime = { html: 'text/html', md: 'text/markdown', txt: 'text/plain', json: 'application/json' }[ext] ?? 'text/plain'
  const blob = new Blob([content], { type: mime + ';charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

// ─── Markdown renderer ───────────────────────────────────────────────────────

function renderMarkdown(md) {
  const esc    = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s) => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="bg-ink/10 px-0.5 rounded text-[0.9em]">$1</code>')
  const proc = (s) => inline(esc(s))

  const lines = md.split('\n')
  let out = ''
  let inList = false

  for (const raw of lines) {
    if (raw.startsWith('### ')) {
      if (inList) { out += '</ul>'; inList = false }
      out += `<h3 class="font-grotesk font-bold text-[13px] text-ink mt-5 mb-1">${proc(raw.slice(4))}</h3>`
    } else if (raw.startsWith('## ')) {
      if (inList) { out += '</ul>'; inList = false }
      out += `<h2 class="font-grotesk font-bold text-[15px] text-ink mt-6 mb-2">${proc(raw.slice(3))}</h2>`
    } else if (raw.startsWith('# ')) {
      if (inList) { out += '</ul>'; inList = false }
      out += `<h1 class="font-grotesk font-bold text-[19px] text-ink mt-6 mb-2">${proc(raw.slice(2))}</h1>`
    } else if (/^[-*] /.test(raw)) {
      if (!inList) { out += '<ul class="list-disc pl-5 my-2 space-y-1">'; inList = true }
      out += `<li class="font-mono text-[12px] text-ink leading-relaxed">${proc(raw.slice(2))}</li>`
    } else if (raw.trim() === '') {
      if (inList) { out += '</ul>'; inList = false }
      out += '<div class="h-2"></div>'
    } else {
      if (inList) { out += '</ul>'; inList = false }
      out += `<p class="font-mono text-[12px] text-ink leading-relaxed mb-1">${proc(raw)}</p>`
    }
  }
  if (inList) out += '</ul>'
  return out
}

// ─── Preview panel ────────────────────────────────────────────────────────────

function PreviewPanel({ file, onClose }) {
  const panelRef = useRef(null)
  const prevName = useRef(null)
  const [width, setWidth] = useState(520)

  useEffect(() => {
    if (file && file.name !== prevName.current) {
      prevName.current = file.name
      gsap.from(panelRef.current, { x: 24, opacity: 0, duration: 0.3, ease: 'power3.out' })
    }
  }, [file])

  const onDragStart = useCallback((e) => {
    e.preventDefault()
    const initX = e.clientX
    const initW = panelRef.current?.offsetWidth ?? 520

    document.body.style.cursor     = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev) => {
      if (!panelRef.current) return
      const newW = Math.max(260, Math.min(initW + initX - ev.clientX, window.innerWidth * 0.8))
      panelRef.current.style.width = `${newW}px`
    }

    const onUp = () => {
      if (panelRef.current) setWidth(panelRef.current.offsetWidth)
      document.body.style.cursor     = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }, [])

  if (!file) return null

  const ext    = file.name.split('.').pop().toLowerCase()
  const isHtml = ext === 'html' || ext === 'htm'
  const isMd   = ext === 'md'

  return (
    <div ref={panelRef} style={{ width }} className="flex-shrink-0 flex overflow-hidden">

      {/* Drag handle */}
      <div
        onMouseDown={onDragStart}
        className="w-1 flex-shrink-0 bg-ink/10 hover:bg-red/50 active:bg-red/70 cursor-col-resize transition-colors duration-100"
      />

      {/* Panel content */}
      <div className="flex-1 flex flex-col bg-offwhite overflow-hidden min-w-0">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink/10 bg-surface/50 flex-shrink-0">
          <div className="min-w-0">
            <p className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted leading-none mb-1">Preview</p>
            <p className="font-mono text-[11px] text-ink truncate">{file.name}</p>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 ml-3 p-1 text-muted/70 hover:text-red transition-colors rounded"
          >
            <X size={13} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {isHtml ? (
            <iframe
              key={file.name}
              srcDoc={file.content ?? ''}
              className="w-full h-full border-0 bg-white"
              sandbox="allow-scripts"
              title={file.name}
            />
          ) : (
            <div className="h-full overflow-y-auto px-5 py-5">
              {isMd ? (
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(file.content ?? '') }} />
              ) : (
                <pre className="font-mono text-[11px] text-ink whitespace-pre-wrap leading-relaxed">
                  {file.content ?? ''}
                </pre>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function fmtTok(n) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n) }

function Sidebar({ isIdle, agentStatus, hasMessages, lastTurnUsage, activeSessionId, sessions, onSwitchSession, onNewSession, creatingSession, onPreviewFile, previewFileName, sessionFiles, onFetchFiles, fetching, fetched, buildingPbip, onBuildPbip, pbipError }) {
  const ref = useRef(null)
  const [sessionUsage, setSessionUsage]   = useState(null)
  const [usageFetched, setUsageFetched]   = useState(false)

  useEffect(() => {
    gsap.from(ref.current, { x: -16, opacity: 0, duration: 0.55, ease: 'power3.out' })
  }, [])

  // Reset usage state when active session changes
  useEffect(() => {
    setSessionUsage(null)
    setUsageFetched(false)
  }, [activeSessionId])

  const fetchUsage = useCallback(async () => {
    try {
      const res  = await fetch(`/api/session-usage?sessionId=${activeSessionId}`)
      const data = await res.json()
      if (data.usage) setSessionUsage(data.usage)
      setUsageFetched(true)
    } catch {}
  }, [activeSessionId])

  useEffect(() => {
    if (isIdle && hasMessages) fetchUsage()
  }, [isIdle, hasMessages, fetchUsage])

  const sessIn    = sessionUsage?.input_tokens ?? 0
  const sessOut   = sessionUsage?.output_tokens ?? 0
  const sessCacheR = sessionUsage?.cache_read_input_tokens ?? 0
  const sessCacheW = (sessionUsage?.cache_creation?.ephemeral_5m_input_tokens ?? 0) +
                     (sessionUsage?.cache_creation?.ephemeral_1h_input_tokens  ?? 0)
  const sessHit   = sessIn > 0 ? Math.round(sessCacheR / sessIn * 100) : 0

  const ltIn      = lastTurnUsage?.input ?? 0
  const ltOut     = lastTurnUsage?.output ?? 0
  const ltCacheR  = lastTurnUsage?.cacheRead ?? 0
  const ltHit     = ltIn > 0 ? Math.round(ltCacheR / ltIn * 100) : 0

  return (
    <aside ref={ref} className="w-52 flex-shrink-0 flex flex-col bg-offwhite border-r border-ink/10">

      {/* Agent info */}
      <div className="px-4 pt-5 pb-4 border-b border-ink/10">
        <div className="flex items-start gap-2.5">
          <span className="relative flex h-2 w-2 flex-shrink-0 mt-1">
            {!isIdle && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red opacity-75" />
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${isIdle ? 'bg-ink/20' : 'bg-red'}`} />
          </span>
          <div>
            <p className="font-mono text-[8px] tracking-[0.18em] uppercase text-muted leading-none mb-1">
              {isIdle ? 'Ready' : agentStatus === 'thinking' ? 'Thinking…' : 'Responding…'}
            </p>
            <p className="font-grotesk font-bold text-[12px] text-ink leading-tight">{AGENT_LABEL}</p>
          </div>
        </div>
      </div>

      {/* Conversations */}
      <div className="px-4 py-3 border-b border-ink/10">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted">Conversations</span>
          <button
            onClick={onNewSession}
            disabled={creatingSession || !isIdle}
            title="New conversation"
            className="flex items-center gap-0.5 font-mono text-[8px] tracking-wider uppercase text-muted/70 hover:text-red transition-colors disabled:opacity-30"
          >
            <Plus size={9} />
            {creatingSession ? 'Creating…' : 'New'}
          </button>
        </div>
        <ul className="flex flex-col gap-0.5 max-h-36 overflow-y-auto">
          {sessions.map((s, i) => {
            const isActive = s.id === activeSessionId
            return (
              <li key={s.id}>
                <button
                  onClick={() => onSwitchSession(s.id)}
                  className={`w-full text-left px-2 py-1.5 rounded-md transition-colors ${
                    isActive ? 'bg-ink/8 text-ink' : 'text-muted hover:bg-ink/5 hover:text-ink'
                  }`}
                >
                  <p className="font-mono text-[10px] leading-snug truncate">
                    {isActive && <span className="text-red mr-1">●</span>}
                    {sessions.length - i === 1 && sessions.length > 1
                      ? 'Original'
                      : `Conversation ${sessions.length - i}`}
                  </p>
                  <p className="font-mono text-[8px] text-muted/70 mt-0.5">{fmtDate(s.createdAt)}</p>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Build PBIP — always visible, state-driven */}
      <div className="px-4 py-3 border-b border-ink/10">
        <div className="flex items-center justify-between mb-2">
          <p className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted">Build PBIP</p>
          {!fetched && !fetching && (
            <button
              onClick={onFetchFiles}
              className="font-mono text-[8px] tracking-wider uppercase text-muted/70 hover:text-red transition-colors"
            >
              Check
            </button>
          )}
          {fetching && (
            <span className="font-mono text-[8px] text-muted/60">…</span>
          )}
          {fetched && !sessionFiles.some(f => f.name === 'dashboard_spec.json') && (
            <button
              onClick={onFetchFiles}
              className="font-mono text-[8px] tracking-wider uppercase text-muted/70 hover:text-red transition-colors"
            >
              Retry
            </button>
          )}
        </div>
        {(() => {
          const hasSpec  = sessionFiles.some(f => f.name === 'dashboard_spec.json')
          const hasModel = sessionFiles.some(f => f.name === 'semantic_model.json')
          const ready    = hasSpec && hasModel
          return (
            <>
              <button
                onClick={ready ? onBuildPbip : undefined}
                disabled={buildingPbip || !ready}
                className="w-full font-mono text-[9px] tracking-wider uppercase px-3 py-2 bg-red text-paper rounded-lg hover:bg-red/80 disabled:opacity-30 transition-colors"
              >
                {buildingPbip ? 'Building…' : 'Build PBIP ↓'}
              </button>
              <p className="font-mono text-[8px] text-muted/60 mt-1.5 leading-snug">
                {fetching
                  ? 'Checking for output files…'
                  : ready
                  ? 'Spec ready — click to download zip'
                  : fetched
                  ? 'No spec found — run the agent first'
                  : 'Click Check to load files from this session'}
              </p>
              {pbipError && (
                <p className="font-mono text-[8px] text-red/80 mt-1 leading-snug">{pbipError}</p>
              )}
            </>
          )
        })()}
      </div>

      {/* Output files */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5">

        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <Paperclip size={9} className="text-muted" />
              <span className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted">Output Files</span>
              {sessionFiles.length > 0 && (
                <span className="bg-red text-paper text-[8px] rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold ml-0.5">
                  {sessionFiles.length}
                </span>
              )}
            </div>
            {hasMessages && (
              <button
                onClick={onFetchFiles}
                disabled={fetching}
                className="font-mono text-[8px] tracking-wider uppercase text-muted/70 hover:text-red transition-colors disabled:opacity-40"
              >
                {fetching ? '…' : fetched ? 'Refresh' : 'Fetch'}
              </button>
            )}
          </div>

          {!hasMessages ? (
            <p className="font-mono text-[10px] text-muted leading-relaxed">Files appear here after the agent runs.</p>
          ) : !fetched ? (
            <p className="font-mono text-[10px] text-muted leading-relaxed">
              {fetching ? 'Loading…' : 'Click Fetch to load output files.'}
            </p>
          ) : sessionFiles.length === 0 ? (
            <p className="font-mono text-[10px] text-muted leading-relaxed">No output files found.</p>
          ) : (
            <>
            <ul className="flex flex-col gap-0.5">
              {sessionFiles.map((f) => {
                const isActive = previewFileName === f.name
                return (
                  <li
                    key={f.name}
                    className={`flex items-center gap-1.5 px-2 py-2 rounded-lg transition-colors group ${
                      isActive ? 'bg-ink/8' : 'hover:bg-surface/70'
                    }`}
                  >
                    <button
                      onClick={() => onPreviewFile?.(f)}
                      className="flex-1 min-w-0 text-left"
                      title={`Preview ${f.name}`}
                    >
                      <span className={`font-mono text-[10px] truncate block ${isActive ? 'text-red' : 'text-ink'}`}>
                        {f.name}
                      </span>
                    </button>
                    <button
                      onClick={() => onPreviewFile?.(f)}
                      className={`flex-shrink-0 transition-colors ${isActive ? 'text-red' : 'text-muted/60 group-hover:text-ink'}`}
                      title={`Preview ${f.name}`}
                    >
                      <Eye size={10} />
                    </button>
                    <button
                      onClick={() => downloadBlob(f.name, f.content)}
                      className="flex-shrink-0 text-muted/60 hover:text-red transition-colors"
                      title={`Download ${f.name}`}
                    >
                      <Download size={10} />
                    </button>
                  </li>
                )
              })}
            </ul>
            </>
          )}
        </div>

        {/* Token usage */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <span className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted">Token Usage</span>
            {hasMessages && usageFetched && (
              <button
                onClick={fetchUsage}
                className="font-mono text-[8px] tracking-wider uppercase text-muted/70 hover:text-red transition-colors"
              >
                Refresh
              </button>
            )}
          </div>

          {!hasMessages && (
            <p className="font-mono text-[10px] text-muted leading-relaxed">Stats appear after first run.</p>
          )}

          {lastTurnUsage && ltIn > 0 && (
            <div className="mb-3">
              <p className="font-mono text-[8px] text-muted/70 uppercase tracking-wider mb-1">Last turn</p>
              <p className="font-mono text-[10px] text-ink">
                {fmtTok(ltIn)} in · {fmtTok(ltOut)} out
              </p>
              {ltCacheR > 0 && (
                <p className="font-mono text-[9px] text-muted">{ltHit}% cached</p>
              )}
            </div>
          )}

          {sessIn > 0 && (
            <div>
              <p className="font-mono text-[8px] text-muted/70 uppercase tracking-wider mb-1">Session total</p>
              <p className="font-mono text-[10px] text-ink">
                {fmtTok(sessIn)} in · {fmtTok(sessOut)} out
              </p>
              {sessCacheR > 0 && (
                <p className="font-mono text-[9px] text-muted">{sessHit}% cached</p>
              )}
              {sessCacheW > 0 && (
                <p className="font-mono text-[9px] text-muted">{fmtTok(sessCacheW)} written to cache</p>
              )}
            </div>
          )}
        </div>

      </div>

    </aside>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ChatInterface() {
  const [messages, setMessages]       = useState([])
  const [input, setInput]             = useState('')
  const [agentStatus, setAgentStatus] = useState('idle')
  const [thinkHint, setThinkHint]     = useState('thinking')
  const [schema, setSchema]               = useState('')
  const [context, setContext]             = useState('')
  const [attachedFiles, setAttachedFiles] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [lastTurnUsage, setLastTurnUsage] = useState(null)
  const [activeSessionId, setActiveSessionId] = useState(DEFAULT_SESSION_ID)
  const [sessions, setSessions]             = useState([])
  const [creatingSession, setCreatingSession] = useState(false)
  const [previewFile, setPreviewFile]       = useState(null)
  const [sessionFiles, setSessionFiles]     = useState([])
  const [fetching, setFetching]             = useState(false)
  const [fetched, setFetched]               = useState(false)
  const [buildingPbip, setBuildingPbip]     = useState(false)
  const [pbipError, setPbipError]           = useState(null)

  const bottomRef    = useRef(null)
  const bodyRef      = useRef(null)
  const inputAreaRef = useRef(null)
  const textareaRef  = useRef(null)
  const turnUsageAccum     = useRef({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  const activeSessionIdRef = useRef(activeSessionId)
  useEffect(() => { activeSessionIdRef.current = activeSessionId }, [activeSessionId])

  const fetchHistory = useCallback(async (sid) => {
    setHistoryLoading(true)
    try {
      const data = await fetch(`/api/session-history?sessionId=${sid}`).then(r => r.json())
      if (data.messages?.length) setMessages(data.messages)
      else setMessages([])
    } catch {}
    setHistoryLoading(false)
  }, [])

  // Bootstrap from localStorage on mount
  useEffect(() => {
    const stored = loadStorage()
    if (stored?.sessions?.length && stored.activeId) {
      setSessions(stored.sessions)
      setActiveSessionId(stored.activeId)
      activeSessionIdRef.current = stored.activeId
      fetchHistory(stored.activeId)
    } else {
      // Seed localStorage with the default session
      const seed = [{ id: DEFAULT_SESSION_ID, createdAt: new Date().toISOString() }]
      setSessions(seed)
      saveStorage(seed, DEFAULT_SESSION_ID)
      fetchHistory(DEFAULT_SESSION_ID)
    }
  }, [fetchHistory])

  const switchSession = useCallback((sid) => {
    if (sid === activeSessionIdRef.current) return
    setActiveSessionId(sid)
    setMessages([])
    setLastTurnUsage(null)
    setInput('')
    setSessions(prev => {
      const updated = prev
      saveStorage(updated, sid)
      return updated
    })
    fetchHistory(sid)
  }, [fetchHistory])

  const createNewSession = useCallback(async () => {
    if (creatingSession) return
    setCreatingSession(true)
    try {
      const res  = await fetch('/api/session/new', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ refSessionId: activeSessionIdRef.current }),
      })
      const data = await res.json()
      if (!data.sessionId) throw new Error('No session ID returned')

      const newEntry = { id: data.sessionId, createdAt: data.createdAt ?? new Date().toISOString() }
      setSessions(prev => {
        const updated = [newEntry, ...prev]
        saveStorage(updated, data.sessionId)
        return updated
      })
      setActiveSessionId(data.sessionId)
      setMessages([])
      setLastTurnUsage(null)
      setInput('')
      setHistoryLoading(false)
    } catch (err) {
      console.error('Failed to create session:', err)
    }
    setCreatingSession(false)
  }, [creatingSession])

  const fetchSessionFiles = useCallback(async () => {
    setFetching(true)
    try {
      const res  = await fetch(`/api/session-files?sessionId=${activeSessionIdRef.current}`)
      const data = await res.json()
      setSessionFiles(data.files ?? [])
      setFetched(true)
    } catch {}
    setFetching(false)
  }, [])

  const buildPbip = useCallback(async () => {
    const specFile  = sessionFiles.find(f => f.name === 'dashboard_spec.json')
    const modelFile = sessionFiles.find(f => f.name === 'semantic_model.json')
    if (!specFile || !modelFile) return
    setBuildingPbip(true)
    setPbipError(null)
    try {
      const buildId = Date.now().toString(36)
      const res = await fetch(
        (process.env.NEXT_PUBLIC_BICOHOST_URL ?? '') + '/api/build',
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dashboard_spec: JSON.parse(specFile.content),
            semantic_model: JSON.parse(modelFile.content),
            build_id: buildId,
          }),
        }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = `pages_${buildId}.zip`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setPbipError(e.message)
    }
    setBuildingPbip(false)
  }, [sessionFiles])

  // Reset file state on session switch
  useEffect(() => {
    setSessionFiles([])
    setFetched(false)
    setPbipError(null)
  }, [activeSessionId])

  // Auto-fetch files when agent goes idle after a conversation
  useEffect(() => {
    if (agentStatus === 'idle' && messages.length > 0 && !fetched) fetchSessionFiles()
  }, [agentStatus, messages.length, fetched, fetchSessionFiles])

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(bodyRef.current,      { opacity: 0, duration: 0.5, ease: 'power2.out', delay: 0.15 })
      gsap.from(inputAreaRef.current, { y: 14, opacity: 0, duration: 0.5, ease: 'power3.out', delay: 0.3 })
    })
    return () => ctx.revert()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, agentStatus])


  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }, [])

  const sendMessage = useCallback(async () => {
    if (agentStatus !== 'idle') return

    const isSetup = messages.length === 0
    let text

    if (isSetup) {
      const hasAny = schema.trim() || context.trim() || attachedFiles.length > 0 || input.trim()
      if (!hasAny) return

      const parts = ["I'm providing my data model and business context for dashboard planning.\n"]
      if (schema.trim())
        parts.push(`## DATA MODEL SCHEMA\n\`\`\`\n${schema.trim()}\n\`\`\``)
      if (context.trim())
        parts.push(`## BUSINESS CONTEXT\n${context.trim()}`)
      for (const f of attachedFiles) {
        if (f.binary || f.readError) {
          parts.push(`## ATTACHED FILE: ${f.name}\n(Binary — content not extracted.)`)
        } else if (f.content) {
          parts.push(`## ATTACHED FILE: ${f.name}\n\`\`\`\n${f.content.slice(0, 40000)}\n\`\`\``)
        }
      }
      if (input.trim()) parts.push(`## ADDITIONAL NOTES\n${input.trim()}`)
      text = parts.join('\n\n')
    } else {
      text = input.trim()
      if (!text) return
    }

    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    if (isSetup) { setSchema(''); setContext(''); setAttachedFiles([]) }
    setAgentStatus('thinking')
    setThinkHint('thinking')
    turnUsageAccum.current = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

    const userMsg  = { role: 'user',  text, time: ts(), id: Date.now() }
    const agentId  = Date.now() + 1
    const agentMsg = { role: 'agent', text: '', time: ts(), id: agentId, streaming: true }

    setMessages((prev) => [...prev, userMsg, agentMsg])

    try {
      const res = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: text, sessionId: activeSessionIdRef.current }),
      })

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''

        for (const part of parts) {
          if (!part.startsWith('data: ')) continue
          let data
          try { data = JSON.parse(part.slice(6)) } catch { continue }

          if (data.type === 'thinking') {
            setAgentStatus('thinking'); setThinkHint('thinking')
          } else if (data.type === 'tool') {
            setThinkHint('tool')
          } else if (data.type === 'usage') {
            const a = turnUsageAccum.current
            a.input    += data.input    ?? 0
            a.output   += data.output   ?? 0
            a.cacheRead  += data.cacheRead  ?? 0
            a.cacheWrite += data.cacheWrite ?? 0
          } else if (data.type === 'message') {
            setAgentStatus('streaming')
            setMessages((prev) =>
              prev.map((m) => (m.id === agentId ? { ...m, text: data.text } : m))
            )
          } else if (data.type === 'done') {
            const finalUsage = { ...turnUsageAccum.current }
            setLastTurnUsage(finalUsage)
            setMessages((prev) =>
              prev.map((m) => (m.id === agentId ? { ...m, streaming: false, usage: finalUsage } : m))
            )
            setAgentStatus('idle')
          } else if (data.type === 'error') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === agentId
                  ? { ...m, text: `[Error: ${data.message}]`, streaming: false, error: true }
                  : m
              )
            )
            setAgentStatus('idle')
          }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === agentId
            ? { ...m, text: `[Network error: ${err.message}]`, streaming: false, error: true }
            : m
        )
      )
      setAgentStatus('idle')
    }
  }, [input, agentStatus, schema, context, attachedFiles, messages])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const isIdle     = agentStatus === 'idle'
  const isSetup    = messages.length === 0
  const hasContent = isSetup
    ? Boolean(schema.trim() || context.trim() || attachedFiles.length > 0 || input.trim())
    : Boolean(input.trim())

  const showThinking = (agentStatus === 'thinking' || thinkHint === 'tool') &&
    messages[messages.length - 1]?.role !== 'agent'

  return (
    <div className="flex h-screen bg-paper font-grotesk overflow-hidden">

      <Sidebar
        isIdle={isIdle}
        agentStatus={agentStatus}
        hasMessages={messages.length > 0}
        lastTurnUsage={lastTurnUsage}
        activeSessionId={activeSessionId}
        sessions={sessions}
        onSwitchSession={switchSession}
        onNewSession={createNewSession}
        creatingSession={creatingSession}
        onPreviewFile={setPreviewFile}
        previewFileName={previewFile?.name}
        sessionFiles={sessionFiles}
        onFetchFiles={fetchSessionFiles}
        fetching={fetching}
        fetched={fetched}
        buildingPbip={buildingPbip}
        onBuildPbip={buildPbip}
        pbipError={pbipError}
      />

      {/* ── MAIN ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Messages */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-6 py-8">

            {historyLoading ? (
              <p className="font-mono text-[10px] text-muted/60 tracking-widest uppercase">Loading history…</p>
            ) : isSetup && (
              <div className="mb-5">
                <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-muted mb-3">
                  Share your data model to begin
                </p>
                <SetupPanels
                  schema={schema}
                  onSchemaChange={setSchema}
                  context={context}
                  onContextChange={setContext}
                  files={attachedFiles}
                  onFilesChange={setAttachedFiles}
                />
              </div>
            )}

            <div className="flex flex-col gap-5">
              {messages.map((msg) =>
                msg.role === 'user'      ? <UserMessage       key={msg.id} msg={msg} /> :
                msg.role === 'compacted' ? <CompactionMarker  key={msg.id} msg={msg} /> :
                                           <AgentMessage      key={msg.id} msg={msg} />
              )}
              {showThinking && <ThinkingBubble hint={thinkHint} />}
            </div>

            <div ref={bottomRef} />
          </div>
        </div>

        {/* Build PBIP action bar — shown when IR files are ready */}
        {isIdle && !isSetup &&
         sessionFiles.some(f => f.name === 'dashboard_spec.json') &&
         sessionFiles.some(f => f.name === 'semantic_model.json') && (
          <div className="flex-shrink-0 px-6 pb-2">
            <div className="max-w-2xl mx-auto">
              <div className="flex items-center justify-between gap-4 bg-ink/[0.04] border border-ink/12 rounded-xl px-4 py-2.5">
                <div className="min-w-0">
                  <p className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted leading-none">
                    Dashboard spec ready
                  </p>
                  {pbipError && (
                    <p className="font-mono text-[9px] text-red/80 mt-1 leading-snug">{pbipError}</p>
                  )}
                </div>
                <button
                  onClick={buildPbip}
                  disabled={buildingPbip}
                  className="flex-shrink-0 font-mono text-[9px] tracking-wider uppercase px-4 py-2 bg-red text-paper rounded-lg hover:bg-red/80 disabled:opacity-40 transition-colors whitespace-nowrap"
                >
                  {buildingPbip ? 'Building…' : 'Build PBIP ↓'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Input */}
        <div ref={inputAreaRef} className="flex-shrink-0 px-6 pb-6">
          <div className="max-w-2xl mx-auto">
            <div className="border border-ink/20 rounded-2xl bg-paper shadow-sm focus-within:border-ink/50 transition-colors duration-200 overflow-hidden">
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => { setInput(e.target.value); resizeTextarea() }}
                onKeyDown={handleKeyDown}
                placeholder={isSetup ? 'Add a note (optional)…' : 'Message…'}
                disabled={!isIdle}
                className="w-full resize-none bg-transparent font-mono text-[13px] text-ink placeholder:text-muted/85 outline-none leading-relaxed disabled:opacity-40 min-h-[46px] max-h-[140px] px-4 pt-3.5 pb-2"
              />
              <div className="flex items-center justify-end px-3 pb-3">
                <button
                  onClick={sendMessage}
                  disabled={!isIdle || !hasContent}
                  className="w-8 h-8 rounded-full bg-ink flex items-center justify-center text-paper disabled:opacity-25 hover:bg-red transition-all duration-200"
                >
                  <ArrowUp size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>

      <PreviewPanel file={previewFile} onClose={() => setPreviewFile(null)} />

    </div>
  )
}
