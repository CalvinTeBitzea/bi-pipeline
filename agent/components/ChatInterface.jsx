// ============================================================================
// WHAT THIS FILE IS, IN BUSINESS TERMS
// ============================================================================
// This is the ENTIRE chat application the user actually sees and interacts
// with: the sidebar (conversation list + token/cost tracking + file
// management), the message thread, the input box, and the file preview
// panel. Every other file in this codebase exists to feed data to, or
// receive actions from, this one. If app/api/chat/route.js is "the phone
// line to the AI team," this file is "the whole reception desk and meeting
// room" the user sits in.
//
// It's a single large file rather than many small ones for a practical
// reason common in fast-moving UI code: the sidebar, message list, and
// input box all need to react to the same shared state (is the agent
// currently thinking? which conversation is active?) — keeping them in one
// file avoids threading that shared state through many layers of separate
// files. As the app grows, natural places to split it out are marked by the
// "─── Section ───" divider comments below.
//
// CONCEPT: React components, state, and "re-rendering"
// -------------------------------------------------------------------------
// This file is built with React, a UI library where you describe a screen
// as a function of DATA ("state") rather than writing step-by-step
// instructions to update the page by hand. `useState` declares a piece of
// data the screen depends on (e.g. "the list of messages"); whenever you
// call its setter function (e.g. `setMessages(...)`), React automatically
// re-runs the relevant part of this file and updates exactly the parts of
// the page that actually changed. `useEffect` is for "side effects" — things
// that need to happen in reaction to a change, but aren't themselves part of
// what's drawn on screen (saving to localStorage, starting an animation,
// scrolling to the bottom). `useCallback` and `useRef` are optimizations/
// escape hatches explained inline below, at the point they're first used in
// a way that matters.
'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { gsap } from 'gsap'
import { ArrowUp, Download, Paperclip, Plus, Eye, X, Moon, Sun, Pencil, Pin, Link, RotateCcw, Trash2 } from 'lucide-react'
import SetupPanels from './SetupPanels'
import * as localWrite from '../lib/localWrite'

const AGENT_LABEL        = 'BI Wireframe Agent'
const DEFAULT_SESSION_ID = process.env.NEXT_PUBLIC_REFERENCE_SESSION_ID || 'sesn_01S3zW6pLxWnwyxZ9rmB6tZB'
// Only the "which conversation was this browser last looking at" pointer is
// kept locally now — the conversation list itself, along with each one's
// nickname/pinned status, is fetched from the server (see /api/sessions and
// /api/session-update) so it's the same on every device, not just this one.
const ACTIVE_ID_KEY      = 'bi_active_session_id'

// CONCEPT: localStorage — this browser's own private notepad
// -------------------------------------------------------------------------
// The REAL conversation history lives on Anthropic's servers (fetched via
// session-history/route.js). What's saved here in the browser's localStorage
// is much smaller: just "which conversations has THIS browser opened, and
// what did I nickname them" — a personal bookmarks list, not the source of
// truth. That's why losing localStorage (a different browser, a cleared
// cache) doesn't lose any real work — it just loses the friendly nicknames
// and the "which one was I looking at" convenience.
function loadActiveId() {
  try { return localStorage.getItem(ACTIVE_ID_KEY) } catch { return null }
}

function saveActiveId(id) {
  try { localStorage.setItem(ACTIVE_ID_KEY, id) } catch {}
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
// The components in this section render ONE chat bubble each — a user
// message, an agent reply, a "context compacted" marker, or a "thinking"
// indicator. Each is a small, focused component (a common React practice:
// break a big screen into named pieces, one per distinct kind of content)
// with its own tiny entrance animation via GSAP.

// One line of "what a specialist agent just did," e.g. "bi-design: write
// dashboard_spec.json" — the building block of the collapsible narration
// trail under each agent reply (see AgentMessage below) and the live,
// still-in-progress version shown while a turn is running (LiveNarration).
function NarrationLine({ entry }) {
  const ref = useRef(null)
  useEffect(() => {
    gsap.from(ref.current, { opacity: 0, y: 4, duration: 0.25, ease: 'power2.out' })
  }, [])

  return (
    <div ref={ref} className="flex items-start gap-2 py-0.5">
      <span className="font-mono text-[9px] text-muted/60 flex-shrink-0 mt-0.5 tabular-nums">{entry.time}</span>
      <span className="font-mono text-[11px] text-ink/80 leading-snug">
        <span className="text-muted">{entry.agent}:</span> {entry.text}
      </span>
    </div>
  )
}

// One reply bubble from the agent team (shown as coming from a single
// "assistant," even though behind the scenes several specialists may have
// worked on it — the coordinator's final message is what's actually
// rendered here). Also carries this turn's token-usage badge and, if any
// subagents narrated their steps, the collapsible "N steps" disclosure.
function AgentMessage({ msg }) {
  const ref = useRef(null)
  const [narrationOpen, setNarrationOpen] = useState(false)
  useEffect(() => {
    gsap.from(ref.current, { x: -10, opacity: 0, duration: 0.4, ease: 'power3.out' })
  }, [])

  const u     = msg.usage
  const hasU  = u && u.input > 0
  const hit   = hasU && u.cacheRead > 0 ? Math.round(u.cacheRead / (u.input + u.cacheRead) * 100) : 0
  const fmtT  = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
  const narration = msg.narration ?? []

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
          {narration.length > 0 && (
            <button
              onClick={() => setNarrationOpen((v) => !v)}
              className="font-mono text-[9px] text-muted/60 hover:text-red transition-colors"
            >
              {narrationOpen ? '▾' : '▸'} {narration.length} step{narration.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
        {narrationOpen && narration.length > 0 && (
          <div className="flex flex-col gap-0.5 mt-2 pl-3 border-l border-ink/10">
            {narration.map((n, i) => <NarrationLine key={i} entry={n} />)}
          </div>
        )}
      </div>
    </div>
  )
}

// One message bubble the USER sent. The very first message of a
// conversation is special: sendMessage() (much further down) bundles the
// schema + business context + attached files into one long, structured
// block of text before it's ever sent — `isStructured` detects that shape
// here so it can be shown collapsed ("[ Schema + context ]") instead of as
// a wall of raw text, since a human doesn't need to re-read their own input
// every time they scroll past it.
function UserMessage({ msg, onRerun, isIdle }) {
  const ref = useRef(null)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    gsap.from(ref.current, { x: 10, opacity: 0, duration: 0.3, ease: 'power3.out' })
  }, [])

  const isStructured = msg.text.startsWith("I'm providing my data model")

  return (
    <div ref={ref} className="flex justify-end">
      <div className="max-w-[75%] group">
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
        <div className="flex items-center justify-end gap-1.5 mt-1">
          {isStructured && (
            // The "rerun" / retry button — same idea as ChatGPT's "Try
            // again" arrow. Only shown on the original setup message, and
            // only enabled once the agent is idle (can't rerun mid-turn).
            // See rerunPrompt below for why this opens a NEW conversation
            // rather than replaying in place.
            <button
              onClick={() => onRerun(msg.text)}
              disabled={!isIdle}
              title="Rerun in a new conversation"
              className="p-0.5 text-muted/70 hover:text-red transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-0"
            >
              <RotateCcw size={11} />
            </button>
          )}
          <p className="font-mono text-[9px] text-muted">{msg.time}</p>
        </div>
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

// The animated "..." indicator shown while the agent team is working and
// hasn't produced a visible reply yet — `hint` lets it say something more
// specific than generic "Thinking" (e.g. "bi-design generating…") when we
// know which specialist is currently active (see SUBAGENT_HINTS in
// app/api/chat/route.js, which is where these hint strings originate).
function ThinkingBubble({ hint }) {
  const ref = useRef(null)
  useEffect(() => {
    gsap.from(ref.current, { x: -10, opacity: 0, duration: 0.3, ease: 'power3.out' })
  }, [])

  // 'thinking'/'tool' are the generic defaults; anything else (e.g. a
  // subagent-specific hint like "bi-design generating…") is shown verbatim.
  const label = hint === 'tool' ? 'Using tool' : hint === 'thinking' || !hint ? 'Thinking' : hint

  return (
    <div ref={ref} className="flex gap-3">
      <div className="flex-shrink-0 w-5 h-5 rounded-full bg-red/30 mt-0.5 animate-pulse" />
      <div className="flex items-center gap-2 py-0.5">
        <span className="font-mono text-[10px] tracking-widest text-muted uppercase">
          {label}
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

// The IN-PROGRESS version of AgentMessage's collapsible narration list —
// rendered directly under the ThinkingBubble WHILE a turn is still running,
// so the user sees each step the moment it happens rather than only after
// the whole reply finishes and gets folded into a collapsed "N steps"
// toggle. This is the actual "watch it think" feature: `entries` streams in
// live from dispatchToAgent's SSE handling further down this file.
function LiveNarration({ entries }) {
  if (!entries.length) return null
  return (
    <div className="flex flex-col gap-0.5 pl-8">
      {entries.map((e, i) => <NarrationLine key={i} entry={e} />)}
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// CONCEPT: Triggering a file download entirely in the browser, no server
// involved
// -------------------------------------------------------------------------
// The agent's output files already live in the browser's memory as plain
// text (fetched via session-files/route.js) — there's no separate "download"
// endpoint to call. A `Blob` is the browser's way of representing that text
// as if it were a real file (with a MIME type, so e.g. a .json downloads as
// recognizably JSON); `URL.createObjectURL` mints a temporary local link to
// it; creating an `<a>` tag and calling `.click()` on it programmatically is
// a common trick to trigger a real "Save As" download without the user ever
// seeing that invisible link element.
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

// CONCEPT: A small, purpose-built Markdown renderer instead of a library
// -------------------------------------------------------------------------
// Markdown is the lightweight "# heading, **bold**, - bullet" text format
// the agent writes its planning specs in. Rather than pulling in a general-
// purpose Markdown library (extra dependency weight for a feature used in
// exactly one preview panel), this hand-rolls just the handful of patterns
// this app's own agents actually produce: headings, bullet lists, bold text,
// inline code, and paragraphs. This is a deliberate "just enough, no more"
// engineering trade-off — appropriate here because the INPUT is controlled
// (our own agents' output, not arbitrary user-supplied Markdown from the
// wider internet), which limits how many edge cases this needs to handle
// correctly.
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

// The slide-out panel that shows one file's full content (rendered as HTML
// in an iframe, formatted Markdown, or plain text) — opened by clicking the
// eye icon next to any file in the sidebar. Business purpose: let a user
// actually LOOK at the wireframe.html or dashboard_spec.json the agent
// produced without downloading it first.
//
// CONCEPT: Using a ref instead of state for something that changes 60x/second
// -------------------------------------------------------------------------
// The panel's width needs to update continuously while the user drags its
// resize handle — potentially many times per second. If `widthRef` were
// React state instead, every single pixel of movement would trigger a full
// React re-render, which is unnecessarily expensive for something this
// high-frequency. Instead, the width is kept in a `useRef` (a plain mutable
// box that does NOT trigger a re-render when changed) and applied directly
// to the DOM element's inline style during the drag — React itself is
// bypassed for the duration of the drag, and only reads from `widthRef`
// again the next time the component happens to re-render for some other
// reason (e.g. a new file being previewed).
function PreviewPanel({ file, onClose }) {
  const panelRef  = useRef(null)
  const prevName  = useRef(null)
  const widthRef  = useRef(520)   // source of truth — avoids React state snapping during drag

  useEffect(() => {
    if (file && file.name !== prevName.current) {
      prevName.current = file.name
      gsap.from(panelRef.current, { x: 24, opacity: 0, duration: 0.3, ease: 'power3.out' })
    }
  }, [file])

  // Standard "manual drag" recipe for anything the browser doesn't support
  // dragging out of the box: on mousedown, attach temporary mousemove/mouseup
  // listeners to the WHOLE document (not just this element, so the drag
  // keeps tracking even if the cursor leaves the handle itself), and remove
  // them again the moment the mouse button is released.
  const onDragStart = useCallback((e) => {
    e.preventDefault()
    const initX = e.clientX
    const initW = widthRef.current

    document.body.style.cursor     = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev) => {
      const newW = Math.max(260, Math.min(initW + (initX - ev.clientX), window.innerWidth * 0.8))
      widthRef.current = newW
      if (panelRef.current) panelRef.current.style.width = `${newW}px`
    }

    const onUp = () => {
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
    <div ref={panelRef} style={{ width: widthRef.current }} className="flex-shrink-0 flex h-full overflow-hidden">

      {/* Drag handle — wide invisible hit area, thin visual indicator */}
      <div
        onMouseDown={onDragStart}
        className="relative w-4 h-full flex-shrink-0 cursor-col-resize group/handle"
      >
        <div className="absolute inset-y-0 left-1.5 w-px bg-ink/10 group-hover/handle:bg-red/50 active:bg-red/70 transition-colors duration-100" />
      </div>

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

// ─── ArchiveSection ──────────────────────────────────────────────────────────

// A collapsed "Archive (N)" disclosure listing every OLDER version of every
// file in the current conversation — e.g. bi-design's first draft of
// dashboard_spec.json, before bi-authoring's feedback led to a rewrite. This
// is the UI for the version history session-files/route.js reconstructs from
// the raw write/edit event log; without it, only the latest version of each
// file would ever be visible, and a user couldn't compare "what changed."
function ArchiveSection({ files, onPreviewFile }) {
  const [open, setOpen] = useState(false)

  const items = files
    .flatMap(f => (f.archive ?? []).map(v => ({ name: f.name, ...v })))
    .sort((a, b) => new Date(b.writtenAt) - new Date(a.writtenAt))

  if (!items.length) return null

  return (
    <div className="mb-1.5">
      <button
        onClick={() => setOpen(o => !o)}
        className="font-mono text-[9px] text-muted hover:text-ink transition-colors flex items-center gap-1"
      >
        {open ? '▾' : '▸'} Archive ({items.length})
      </button>
      {open && (
        <ul className="mt-1 flex flex-col gap-0 pl-2 border-l border-ink/10">
          {items.map((item, i) => (
            <li key={i} className="flex items-center gap-0.5">
              <button
                onClick={() => onPreviewFile?.({ name: item.name, content: item.content })}
                className="flex-1 min-w-0 text-left font-mono text-[10px] truncate py-0.5 text-muted hover:text-ink transition-colors"
              >
                {item.name}
              </button>
              <span className="font-mono text-[9px] text-muted flex-shrink-0 mr-0.5">v{item.version}</span>
              <button
                onClick={() => {
                  const dotIdx = item.name.lastIndexOf('.')
                  const versioned = dotIdx > -1
                    ? `${item.name.slice(0, dotIdx)}_v${item.version}${item.name.slice(dotIdx)}`
                    : `${item.name}_v${item.version}`
                  downloadBlob(versioned, item.content)
                }}
                className="flex-shrink-0 p-0.5 text-muted hover:text-ink transition-colors"
                title={`Download v${item.version}`}
              >
                <Download size={10} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── SessionItem ─────────────────────────────────────────────────────────────

// A conversation with no custom nickname yet is labeled by its POSITION
// among all conversations ("Conversation 3"), oldest first — with the very
// first one this browser ever knew about called "Original" once other
// conversations exist, so a returning user can always tell which one they
// started with.
function sessionFallbackName(sessions, id) {
  const i = sessions.findIndex(s => s.id === id)
  if (i === -1) return 'Conversation'
  const pos = sessions.length - i
  return pos === 1 && sessions.length > 1 ? 'Original' : `Conversation ${pos}`
}

// One row in the sidebar's conversation list. When it's the ACTIVE
// conversation, it expands to show that conversation's output files and a
// "Build PBIP" button — the actual end goal of this whole pipeline: turning
// the AI-authored dashboard_spec.json/semantic_model.json into a real,
// downloadable Power BI project folder (a .pbip project) that opens directly
// in Power BI Desktop. That conversion itself is deliberately NOT done by
// the AI — it calls out to the separate, deterministic `builder` service
// (see the builder/ directory) precisely because turning a spec into exact,
// valid Power BI file formats is the kind of mechanical, must-be-precisely-
// correct task regular code does more reliably than an AI model free-styling
// file contents from scratch.
function SessionItem({
  session, fallbackName, isActive, onSwitch, onRename, onPin, onDelete,
  sessionFiles = [], fetching = false, fetched = false, onFetchFiles,
  onPreviewFile, previewFileName, buildingPbip, onBuildPbip, pbipError,
  onRegenerateFiles, isIdle = true, selectMode = false, selected = false, onToggleSelect,
  reportFolderReady = false, onApplyToFolder, applyingToFolder = false, applyResult = null, applyError = null,
}) {
  const [editing, setEditing]   = useState(false)
  const [editName, setEditName] = useState('')
  const inputRef = useRef(null)

  const startEdit = (e) => {
    e.stopPropagation()
    setEditName(session.name || '')
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    const trimmed = editName.trim()
    // Clearing the field back to blank is treated as "cancel," not "clear
    // the name" — the underlying session API can't actually revert a title
    // to unset once one's been given, so pretending it can would show a
    // blank name locally that silently reappears after the next reload.
    if (trimmed && trimmed !== session.name) onRename(session.id, trimmed)
  }

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const displayName = session.name || fallbackName
  const hasSpec     = sessionFiles.some(f => f.name === 'dashboard_spec.json')
  const hasModel    = sessionFiles.some(f => f.name === 'semantic_model.json')
  const canBuild    = hasSpec && hasModel
  const buildHint   = !hasSpec && !hasModel
    ? 'Needs dashboard_spec.json + semantic_model.json'
    : !hasSpec ? 'Missing: dashboard_spec.json'
    : 'Missing: semantic_model.json'

  // Readiness dot for non-active sessions (uses persisted fileStatus, no fetch needed)
  const fileStatus = session.fileStatus
  const statusDot  = !isActive && fileStatus
    ? (fileStatus.hasSpec && fileStatus.hasModel ? 'ready' : 'partial')
    : null

  return (
    <li>
      {/* Session row */}
      <div className={`group flex items-center gap-1 px-2 py-2 rounded-md transition-colors ${
        isActive ? 'bg-ink/8' : 'hover:bg-ink/5'
      }`}>
        {selectMode && !editing && (
          // Batch-select checkbox — only shown once "Select" mode is turned
          // on in the sidebar header. Clicking a row in this mode toggles
          // its checkbox instead of switching to that conversation.
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(session.id)}
            onClick={(e) => e.stopPropagation()}
            className="flex-shrink-0 w-3.5 h-3.5 accent-red cursor-pointer"
          />
        )}
        {editing ? (
          <input
            ref={inputRef}
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
            autoFocus
            placeholder={displayName}
            className="flex-1 min-w-0 font-mono text-[13px] bg-transparent border-b border-ink/30 outline-none text-ink placeholder:text-muted/40 py-0"
          />
        ) : (
          <button
            onClick={() => selectMode ? onToggleSelect(session.id) : onSwitch(session.id)}
            className="flex-1 min-w-0 text-left"
          >
            <p className={`font-mono text-[13px] leading-snug truncate ${isActive ? 'text-ink' : 'text-ink/60'}`}>
              {isActive && <span className="text-red mr-1">●</span>}
              {session.pinned && !isActive && <span className="text-muted/60 mr-1">⊙</span>}
              {displayName}
            </p>
            <p className="font-mono text-[10px] text-muted mt-0.5">
              {fmtDate(session.createdAt)}
              {statusDot && (
                <span
                  style={{ color: statusDot === 'ready' ? '#22c55e' : '#f59e0b' }}
                  className="ml-1 text-[8px]"
                  title={statusDot === 'ready' ? 'PBIP files ready' : 'PBIP files incomplete'}
                >●</span>
              )}
            </p>
          </button>
        )}
        {!editing && !selectMode && (
          <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={startEdit} title="Rename" className="p-0.5 text-muted hover:text-ink transition-colors">
              <Pencil size={11} />
            </button>
            <button
              onClick={() => onPin(session.id)}
              title={session.pinned ? 'Unpin' : 'Pin'}
              className={`p-0.5 transition-colors ${session.pinned ? 'text-red hover:text-red/60' : 'text-muted hover:text-red'}`}
            >
              <Pin size={11} />
            </button>
            <button
              onClick={() => onDelete(session.id)}
              title="Delete conversation"
              className="p-0.5 text-muted hover:text-red transition-colors"
            >
              <Trash2 size={11} />
            </button>
          </div>
        )}
      </div>

      {/* Nested files + build action — only for the active session */}
      {isActive && (
        <div className="ml-4 pl-3 border-l border-ink/10 mt-0.5 mb-2">
          {!fetched && !fetching && (
            <button onClick={onFetchFiles} className="font-mono text-[10px] text-muted hover:text-red transition-colors py-1">
              Load files →
            </button>
          )}
          {fetching && <p className="font-mono text-[10px] text-muted py-1">Loading…</p>}
          {fetched && sessionFiles.length === 0 && (
            <div className="py-1">
              <p className="font-mono text-[10px] text-muted mb-1.5">No output files yet</p>
              {onRegenerateFiles && (
                <button
                  onClick={() => onRegenerateFiles(['dashboard_spec.json', 'semantic_model.json'])}
                  disabled={!isIdle}
                  className="w-full font-mono text-[9px] tracking-wider uppercase px-2 py-1.5 bg-ink/8 text-muted hover:text-ink disabled:opacity-30 rounded transition-colors"
                >
                  Generate missing files →
                </button>
              )}
            </div>
          )}
          {fetched && sessionFiles.length > 0 && (
            <>
              {/* File list header with refresh */}
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[9px] text-muted">
                  {sessionFiles.length} file{sessionFiles.length !== 1 ? 's' : ''}
                </span>
                <button
                  onClick={onFetchFiles}
                  disabled={fetching}
                  title="Refresh files"
                  className="font-mono text-[9px] text-muted hover:text-red transition-colors disabled:opacity-30"
                >
                  ↻
                </button>
              </div>

              {/* Current files */}
              <ul className="flex flex-col gap-0 mb-1.5">
                {sessionFiles.map(f => {
                  const isPreviewing = previewFileName === f.name
                  return (
                    <li key={f.name} className="flex items-center gap-0.5">
                      <button
                        onClick={() => onPreviewFile?.(f)}
                        className={`flex-1 min-w-0 text-left font-mono text-[11px] truncate py-0.5 transition-colors ${
                          isPreviewing ? 'text-red' : 'text-ink/60 hover:text-ink'
                        }`}
                      >
                        {f.name}
                      </button>
                      {f.version > 1 && (
                        <span className="font-mono text-[9px] text-muted flex-shrink-0 mr-0.5">v{f.version}</span>
                      )}
                      <button
                        onClick={() => onPreviewFile?.(f)}
                        className={`flex-shrink-0 p-0.5 transition-colors ${isPreviewing ? 'text-red' : 'text-muted hover:text-ink'}`}
                        title={`Preview ${f.name}`}
                      >
                        <Eye size={11} />
                      </button>
                      <button
                        onClick={() => downloadBlob(f.name, f.content)}
                        className="flex-shrink-0 p-0.5 text-muted hover:text-red transition-colors"
                        title={`Download ${f.name}`}
                      >
                        <Download size={11} />
                      </button>
                    </li>
                  )
                })}
              </ul>

              {/* Archived older versions — collapsible */}
              <ArchiveSection files={sessionFiles} onPreviewFile={onPreviewFile} />

              {/* Build PBIP — always shown when files are loaded, disabled until spec is ready.
                  With a report folder connected, this becomes the PRIMARY
                  "apply directly" action, with a "Download zip instead"
                  fallback still available underneath it — the manual path
                  never goes away, it just steps back to secondary billing. */}
              <div className="mt-1.5">
                <button
                  onClick={canBuild ? (reportFolderReady ? onApplyToFolder : onBuildPbip) : undefined}
                  disabled={!canBuild || buildingPbip || applyingToFolder}
                  className={`w-full font-mono text-[10px] tracking-wider uppercase px-2 py-2 rounded transition-colors ${
                    canBuild
                      ? 'bg-red text-paper hover:bg-red/80 disabled:opacity-30'
                      : 'bg-ink/8 text-muted cursor-default'
                  }`}
                >
                  {reportFolderReady
                    ? (applyingToFolder ? 'Applying…' : 'Apply to report folder ↓')
                    : (buildingPbip ? 'Building…' : 'Build PBIP ↓')}
                </button>
                {canBuild && reportFolderReady && (
                  <button
                    onClick={onBuildPbip}
                    disabled={buildingPbip || applyingToFolder}
                    className="w-full mt-1 font-mono text-[9px] tracking-wider uppercase text-muted hover:text-ink transition-colors disabled:opacity-30"
                  >
                    {buildingPbip ? 'Building…' : 'Download zip instead'}
                  </button>
                )}
                {applyResult && (
                  <div className="mt-1.5 font-mono text-[9px] text-ink/80 leading-snug">
                    <p>✓ Wrote {applyResult.pagesWritten} page file(s) to {applyResult.reportFolderName}</p>
                    {applyResult.measuresTableResult && (
                      <p>
                        {applyResult.measuresTableResult.notFound
                          ? `⚠ ${applyResult.modelFolderName ? '' : 'No .SemanticModel folder found — '}couldn't add ${applyResult.measuresTableName} (see Download zip to add it by hand)`
                          : applyResult.measuresTableResult.created
                          ? `✓ Created ${applyResult.measuresTableName} with ${applyResult.measuresTableResult.added.length} measure(s)`
                          : `${applyResult.measuresTableName}: +${applyResult.measuresTableResult.added.length} measure(s)${applyResult.measuresTableResult.skipped.length ? `, ${applyResult.measuresTableResult.skipped.length} already present` : ''}`}
                      </p>
                    )}
                    {applyResult.modelRefResult?.error && (
                      <p>⚠ {applyResult.modelRefResult.error}</p>
                    )}
                    {applyResult.modelRefResult?.added && (
                      <p>✓ Registered {applyResult.measuresTableName} in model.tmdl</p>
                    )}
                  </div>
                )}
                {applyError && (
                  <p className="font-mono text-[10px] text-red/80 mt-1.5 leading-snug" title={applyError}>
                    {applyError}
                  </p>
                )}
                {!canBuild && (
                  <div className="mt-1.5">
                    <p className="font-mono text-[9px] text-muted leading-snug mb-1.5">{buildHint}</p>
                    {onRegenerateFiles && (
                      <button
                        onClick={() => {
                          const missing = []
                          if (!hasSpec) missing.push('dashboard_spec.json')
                          if (!hasModel) missing.push('semantic_model.json')
                          onRegenerateFiles(missing)
                        }}
                        disabled={!isIdle}
                        className="w-full font-mono text-[9px] tracking-wider uppercase px-2 py-1.5 bg-ink/8 text-muted hover:text-ink disabled:opacity-30 rounded transition-colors"
                      >
                        Generate missing files →
                      </button>
                    )}
                  </div>
                )}
                {pbipError && (
                  <p className="font-mono text-[10px] text-red/80 mt-1.5 leading-snug" title={pbipError}>
                    {pbipError.split('\n')[0].slice(0, 120)}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </li>
  )
}

// ─── ConversationHeader ───────────────────────────────────────────────────────

// The editable conversation title shown above the message thread — click to
// rename, same pattern as the rename control in the sidebar's SessionItem
// (two separate places a user can rename the same conversation, both
// writing to the same underlying `sessions` state in the main component).
function ConversationHeader({ name, fallback, onRename }) {
  const [editing, setEditing]   = useState(false)
  const [editName, setEditName] = useState('')

  const start = () => { setEditName(name || ''); setEditing(true) }

  const commit = () => {
    setEditing(false)
    const trimmed = editName.trim()
    // Same "clearing to blank cancels rather than clears" reasoning as
    // SessionItem's commit() — the session API can't actually unset a
    // title once one's been set.
    if (trimmed && trimmed !== name) onRename(trimmed)
  }

  if (editing) return (
    <input
      value={editName}
      onChange={e => setEditName(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
      autoFocus
      placeholder={fallback}
      className="font-grotesk font-bold text-[13px] text-ink bg-transparent border-b border-ink/30 outline-none w-full max-w-sm placeholder:text-muted/40"
    />
  )

  return (
    <button onClick={start} className="group flex items-center gap-2 text-left">
      <span className={`font-grotesk font-bold text-[13px] leading-snug ${name ? 'text-ink' : 'text-muted/50'}`}>
        {name || fallback}
      </span>
      <Pencil size={9} className="text-muted/30 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </button>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function fmtTok(n) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n) }

function fmtDuration(sec) {
  if (!sec || sec < 1) return '0s'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.round(sec % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function fmtCost(n) { return n == null ? '—' : `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}` }

// The entire left-hand panel: agent status indicator, the always-visible
// cost/token summary strip, the conversation list (each row rendered by
// SessionItem above), and the detailed token-usage/cost breakdown panel.
// This is the "control room" of the app — everything here is either
// navigation (switch/rename/pin conversations) or observability (how much
// is this costing, what files exist) rather than the conversation itself.
function Sidebar({ isIdle, agentStatus, hasMessages, lastTurnUsage, activeSessionId, sessions, onSwitchSession, onNewSession, creatingSession, onLinkSession, onPreviewFile, previewFileName, sessionFiles, onFetchFiles, fetching, fetched, buildingPbip, onBuildPbip, pbipError, onRegenerateFiles, darkMode, onToggleDark, onRenameSession, onPinSession, onDeleteSessions, reportFolderSupported, reportFolderName, reportFolderReady, onConnectFolder, onReconnectFolder, onDisconnectFolder, onApplyToFolder, applyingToFolder, applyResult, applyError }) {
  const ref = useRef(null)
  // Batch-select state lives here (not in the parent) — it's pure sidebar UI
  // state, nothing outside this component needs to know which rows are
  // currently checked.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())

  const toggleSelectMode = useCallback(() => {
    setSelectMode(v => !v)
    setSelectedIds(new Set())
  }, [])

  const toggleSelected = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const deleteOne = useCallback((id) => {
    if (!window.confirm('Delete this conversation? This permanently removes it — it cannot be undone.')) return
    onDeleteSessions([id])
  }, [onDeleteSessions])

  const deleteSelected = useCallback(() => {
    const ids = [...selectedIds]
    if (!ids.length) return
    if (!window.confirm(`Delete ${ids.length} conversation${ids.length === 1 ? '' : 's'}? This permanently removes them — it cannot be undone.`)) return
    onDeleteSessions(ids)
    setSelectedIds(new Set())
    setSelectMode(false)
  }, [selectedIds, onDeleteSessions])
  const [sessionUsage, setSessionUsage]   = useState(null)
  const [runCost, setRunCost]             = useState(null)
  const [usageFetched, setUsageFetched]   = useState(false)
  const [projectUsage, setProjectUsage]   = useState(null)

  useEffect(() => {
    gsap.from(ref.current, { x: -16, opacity: 0, duration: 0.55, ease: 'power3.out' })
  }, [])

  // Reset usage state when active session changes
  useEffect(() => {
    setSessionUsage(null)
    setRunCost(null)
    setUsageFetched(false)
  }, [activeSessionId])

  const fetchUsage = useCallback(async () => {
    try {
      const res  = await fetch(`/api/session-usage?sessionId=${activeSessionId}`)
      const data = await res.json()
      if (data.usage) setSessionUsage(data.usage)
      if (data.cost) setRunCost({ elapsedSeconds: data.elapsedSeconds, ...data.cost })
      setUsageFetched(true)
    } catch {}
  }, [activeSessionId])

  // Total to date across every conversation in this project (server-side, so
  // it reflects work done from any machine, not just this browser's history).
  const fetchProjectUsage = useCallback(async () => {
    try {
      const res  = await fetch('/api/project-usage')
      const data = await res.json()
      if (!data.error) setProjectUsage(data)
    } catch {}
  }, [])

  // Fetch once on load so the total is visible immediately, before any run in
  // this tab — then again whenever a run finishes, so it stays current.
  useEffect(() => { fetchProjectUsage() }, [fetchProjectUsage])

  useEffect(() => {
    if (isIdle && hasMessages) { fetchUsage(); fetchProjectUsage() }
  }, [isIdle, hasMessages, fetchUsage, fetchProjectUsage])

  const sessIn    = sessionUsage?.input_tokens ?? 0
  const sessOut   = sessionUsage?.output_tokens ?? 0
  const sessCacheR = sessionUsage?.cache_read_input_tokens ?? 0
  const sessCacheW = (sessionUsage?.cache_creation?.ephemeral_5m_input_tokens ?? 0) +
                     (sessionUsage?.cache_creation?.ephemeral_1h_input_tokens  ?? 0)
  const sessHit   = (sessIn + sessCacheR) > 0 ? Math.round(sessCacheR / (sessIn + sessCacheR) * 100) : 0

  const ltIn      = lastTurnUsage?.input ?? 0
  const ltOut     = lastTurnUsage?.output ?? 0
  const ltCacheR  = lastTurnUsage?.cacheRead ?? 0
  const ltHit     = (ltIn + ltCacheR) > 0 ? Math.round(ltCacheR / (ltIn + ltCacheR) * 100) : 0

  return (
    <aside ref={ref} className="w-80 flex-shrink-0 flex flex-col bg-offwhite border-r border-ink/10">

      {/* Agent info */}
      <div className="px-4 pt-5 pb-4 border-b border-ink/10">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5 min-w-0">
            <span className="relative flex h-2 w-2 flex-shrink-0 mt-1">
              {!isIdle && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red opacity-75" />
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${isIdle ? 'bg-ink/20' : 'bg-red'}`} />
            </span>
            <div className="min-w-0">
              <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-muted leading-none mb-1">
                {isIdle ? 'Ready' : agentStatus === 'thinking' ? 'Thinking…' : 'Responding…'}
              </p>
              <p className="font-grotesk font-bold text-[14px] text-ink leading-tight truncate">{AGENT_LABEL}</p>
            </div>
          </div>
          <div className="flex-shrink-0 flex items-center gap-0.5">
            <button
              onClick={onToggleDark}
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-1 text-muted/60 hover:text-ink transition-colors rounded"
            >
              {darkMode ? <Sun size={12} /> : <Moon size={12} />}
            </button>
          </div>
        </div>
      </div>

      {/* Cost/token visibility strip — always rendered, never scrolled out of
          view, so spend is visible the moment the interface is opened. */}
      <div className="flex-shrink-0 px-4 py-2.5 border-b border-ink/10 bg-ink/[0.02]">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[9px] tracking-[0.15em] uppercase text-ink/40">Project to date</span>
          <span className="font-mono text-[11px] text-ink font-medium">
            {projectUsage
              ? `${fmtCost(projectUsage.totalCost)} · ${fmtTok(projectUsage.totalUsage.input + projectUsage.totalUsage.output)} tok`
              : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-1">
          <span className="font-mono text-[9px] tracking-[0.15em] uppercase text-ink/40">This conversation</span>
          <span className="font-mono text-[11px] text-ink font-medium">
            {runCost
              ? `${fmtCost(runCost.total)} · ${fmtTok(sessIn + sessOut)} tok`
              : '—'}
          </span>
        </div>
      </div>

      {/* Report folder connect — entirely absent in browsers that don't
          support the File System Access API (Safari, Firefox) rather than
          showing a control that would just fail; the zip download in each
          conversation's Build PBIP section works everywhere regardless. */}
      {reportFolderSupported && (
        <div className="flex-shrink-0 px-4 py-2.5 border-b border-ink/10">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[9px] tracking-[0.15em] uppercase text-ink/40">Report folder</span>
            {reportFolderName ? (
              <div className="flex items-center gap-1.5">
                <span className={`font-mono text-[10px] ${reportFolderReady ? 'text-ink' : 'text-muted'}`}>
                  {reportFolderName}
                </span>
                {!reportFolderReady && (
                  <button
                    onClick={onReconnectFolder}
                    title="Re-grant permission"
                    className="font-mono text-[9px] uppercase text-red hover:text-red/70 transition-colors"
                  >
                    Reconnect
                  </button>
                )}
                <button
                  onClick={onDisconnectFolder}
                  title="Disconnect"
                  className="text-muted hover:text-red transition-colors"
                >
                  <X size={11} />
                </button>
              </div>
            ) : (
              <button
                onClick={onConnectFolder}
                className="font-mono text-[9px] tracking-wider uppercase text-muted hover:text-red transition-colors"
              >
                Connect →
              </button>
            )}
          </div>
          {reportFolderName && (
            <p className="font-mono text-[9px] text-muted/70 mt-1 leading-snug">
              {reportFolderReady
                ? 'Build PBIP will write pages + merge measures here directly.'
                : 'Permission needed again — click Reconnect to resume writing here.'}
            </p>
          )}
        </div>
      )}

      {/* Conversations header — a "Select" toggle switches the list into
          batch-select mode (checkboxes on every row, click-to-check instead
          of click-to-switch); once at least one row is checked, "New" is
          replaced by a "Delete (n)" action. This checkbox-list pattern
          (rather than trying to replicate OS-style ctrl/shift-click inside
          a scrollable list) is the same one most mail/file-manager apps use
          for exactly this kind of batch action — unambiguous with a mouse
          OR touch, and doesn't fight the browser's own click handling. */}
      <div className="flex-shrink-0 px-4 pt-3 pb-2 flex items-center justify-between border-b border-ink/10">
        <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-ink/50">Conversations</span>
        <div className="flex items-center gap-2">
          {selectMode ? (
            <>
              {selectedIds.size > 0 && (
                <button
                  onClick={deleteSelected}
                  title="Delete selected"
                  className="flex items-center gap-0.5 font-mono text-[10px] tracking-wider uppercase text-red hover:text-red/70 transition-colors"
                >
                  <Trash2 size={9} />
                  Delete ({selectedIds.size})
                </button>
              )}
              <button
                onClick={toggleSelectMode}
                className="font-mono text-[10px] tracking-wider uppercase text-muted hover:text-ink transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={toggleSelectMode}
                title="Select conversations to delete"
                className="font-mono text-[10px] tracking-wider uppercase text-muted hover:text-red transition-colors"
              >
                Select
              </button>
              <button
                onClick={onNewSession}
                disabled={creatingSession || !isIdle}
                title="New conversation"
                className="flex items-center gap-0.5 font-mono text-[10px] tracking-wider uppercase text-muted hover:text-red transition-colors disabled:opacity-30"
              >
                <Plus size={9} />
                {creatingSession ? 'Creating…' : 'New'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Scrollable body — sessions list + token usage */}
      <div className="flex-1 overflow-y-auto">

        <div className="px-3 pt-2 pb-2">
          {(() => {
            const pinned   = sessions.filter(s => s.pinned)
            const unpinned = sessions.filter(s => !s.pinned)
            const ordered  = [...pinned, ...unpinned]
            return (
              <ul className="flex flex-col gap-0.5">
                {ordered.map(s => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    fallbackName={sessionFallbackName(sessions, s.id)}
                    isActive={s.id === activeSessionId}
                    onSwitch={onSwitchSession}
                    onRename={onRenameSession}
                    onPin={onPinSession}
                    onDelete={deleteOne}
                    sessionFiles={s.id === activeSessionId ? sessionFiles : []}
                    fetching={s.id === activeSessionId ? fetching : false}
                    fetched={s.id === activeSessionId ? fetched : false}
                    onFetchFiles={onFetchFiles}
                    onPreviewFile={onPreviewFile}
                    previewFileName={previewFileName}
                    buildingPbip={buildingPbip}
                    onBuildPbip={onBuildPbip}
                    pbipError={s.id === activeSessionId ? pbipError : null}
                    onRegenerateFiles={onRegenerateFiles}
                    isIdle={isIdle}
                    selectMode={selectMode}
                    selected={selectedIds.has(s.id)}
                    onToggleSelect={toggleSelected}
                    reportFolderReady={reportFolderReady}
                    onApplyToFolder={onApplyToFolder}
                    applyingToFolder={s.id === activeSessionId ? applyingToFolder : false}
                    applyResult={s.id === activeSessionId ? applyResult : null}
                    applyError={s.id === activeSessionId ? applyError : null}
                  />
                ))}
              </ul>
            )
          })()}
        </div>

        {/* Token usage */}
        <div className="px-4 py-4 border-t border-ink/10 mt-2">
          <div className="flex items-center justify-between mb-2.5">
            <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-ink/50">Token Usage</span>
            {(projectUsage || (hasMessages && usageFetched)) && (
              <button
                onClick={() => { fetchProjectUsage(); if (hasMessages) fetchUsage() }}
                className="font-mono text-[10px] tracking-wider uppercase text-muted hover:text-red transition-colors"
              >
                Refresh
              </button>
            )}
          </div>

          {projectUsage && (
            <div className="mb-3 pb-3 border-b border-ink/10">
              <p className="font-mono text-[10px] text-muted uppercase tracking-wider mb-1">
                Project total · {projectUsage.sessionCount} conversation{projectUsage.sessionCount === 1 ? '' : 's'}
              </p>
              <p className="font-mono text-[13px] text-ink font-medium">
                {fmtCost(projectUsage.totalCost)} · {fmtTok(projectUsage.totalUsage.input + projectUsage.totalUsage.output)} tok
              </p>
              {projectUsage.byAgent && Object.keys(projectUsage.byAgent).length > 1 && (
                <ul className="mt-1.5 flex flex-col gap-0.5">
                  {Object.entries(projectUsage.byAgent).map(([name, a]) => (
                    <li key={name} className="flex items-center justify-between font-mono text-[10px] text-muted">
                      <span className="truncate">{name}</span>
                      <span className="flex-shrink-0 ml-2">{fmtTok(a.input + a.output)} tok · {fmtCost(a.cost)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!hasMessages ? (
            <p className="font-mono text-[11px] text-muted leading-relaxed">Per-conversation stats appear after first run.</p>
          ) : (
            <>
              {runCost && (
                <div className="mb-3 pb-3 border-b border-ink/10">
                  <p className="font-mono text-[10px] text-muted uppercase tracking-wider mb-1">This conversation</p>
                  <p className="font-mono text-[13px] text-ink font-medium">
                    {fmtDuration(runCost.elapsedSeconds)} · {fmtCost(runCost.total)}
                  </p>
                  {runCost.byAgent && Object.keys(runCost.byAgent).length > 1 && (
                    <ul className="mt-1.5 flex flex-col gap-0.5">
                      {Object.entries(runCost.byAgent).map(([name, a]) => (
                        <li key={name} className="flex items-center justify-between font-mono text-[10px] text-muted">
                          <span className="truncate">{name}</span>
                          <span className="flex-shrink-0 ml-2">{fmtTok(a.input + a.output)} tok · {fmtCost(a.cost)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {lastTurnUsage && ltIn > 0 && (
                <div className="mb-3">
                  <p className="font-mono text-[10px] text-muted uppercase tracking-wider mb-1">Last turn</p>
                  <p className="font-mono text-[12px] text-ink">
                    {fmtTok(ltIn)} in · {fmtTok(ltOut)} out
                  </p>
                  {ltCacheR > 0 && (
                    <p className="font-mono text-[10px] text-muted">{ltHit}% cached</p>
                  )}
                </div>
              )}
              {sessIn > 0 && (
                <div>
                  <p className="font-mono text-[10px] text-muted uppercase tracking-wider mb-1">Session total</p>
                  <p className="font-mono text-[12px] text-ink">
                    {fmtTok(sessIn)} in · {fmtTok(sessOut)} out
                  </p>
                  {sessCacheR > 0 && (
                    <p className="font-mono text-[10px] text-muted">{sessHit}% cached</p>
                  )}
                  {sessCacheW > 0 && (
                    <p className="font-mono text-[10px] text-muted">{fmtTok(sessCacheW)} written to cache</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

      </div>

    </aside>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

// The root component for the whole app (rendered directly by app/page.jsx).
// It owns essentially all shared state — which conversation is active, the
// message list, whether the agent is currently working — and passes pieces
// of it down to Sidebar, the message components, and SetupPanels as props.
// In React, state generally lives in the nearest shared ancestor of every
// component that needs to read or change it; since the sidebar, the message
// thread, and the input box all need to agree on "which conversation, is it
// busy right now," that state has to live here, one level above all three.
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
  // "Connect a local report folder" feature state — see lib/localWrite.js
  // for the actual File System Access API mechanics. `reportFolderName` is
  // non-null once ANY folder has ever been picked (even if permission has
  // since lapsed); `reportFolderReady` additionally requires that
  // permission is currently granted — the UI uses the gap between those two
  // to show a "Reconnect" prompt instead of silently failing.
  // Starts false unconditionally, same reasoning as darkMode below: this is
  // feature-detected via `window`, which doesn't exist during server
  // rendering — computing it inline in JSX would render differently on the
  // server (always unsupported) vs. the client (whatever the real browser
  // supports), which is a direct, textbook hydration mismatch. Set for real
  // in a mount-only useEffect instead, which never participates in the
  // server/client comparison.
  const [reportFolderSupported, setReportFolderSupported] = useState(false)
  const [reportFolderHandle, setReportFolderHandle] = useState(null)
  const [reportFolderName, setReportFolderName]     = useState(null)
  const [reportFolderReady, setReportFolderReady]   = useState(false)
  const [applyingToFolder, setApplyingToFolder]     = useState(false)
  const [applyResult, setApplyResult]               = useState(null)
  const [applyError, setApplyError]                 = useState(null)
  // Starts false unconditionally (matching what the server, which has no
  // localStorage, always renders) rather than reading localStorage in the
  // initializer — that earlier version caused a real hydration mismatch for
  // any returning user who'd previously turned dark mode on: the server's
  // HTML always assumed light, but the client's first render would already
  // see the saved '1' and render dark, and React would flag the mismatch on
  // every single page load. Corrected from localStorage in a useEffect
  // below instead, which only ever runs after hydration — the honest
  // trade-off is a brief flash of light mode before it corrects, which is
  // the standard, accepted fix for this exact class of SSR/localStorage bug.
  const [darkMode, setDarkMode]             = useState(false)
  const [liveNarration, setLiveNarration] = useState([])

  const bottomRef    = useRef(null)
  const bodyRef      = useRef(null)
  const inputAreaRef = useRef(null)
  const textareaRef  = useRef(null)
  // These two accumulate data across MANY individual SSE events during one
  // turn (see dispatchToAgent below) before being committed to real state
  // once at the end — using refs here avoids triggering a re-render on every
  // single streamed token-usage or narration event, only when it's actually
  // time to show the final result.
  const turnUsageAccum     = useRef({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  const turnNarrationAccum = useRef([])
  // CONCEPT: The "stale closure" problem, and why this ref exists
  // -----------------------------------------------------------------------
  // `dispatchToAgent` (below) is defined ONCE and reused for many different
  // sends — but JavaScript closures capture variables' values AT THE TIME
  // the function was created, not fresh each call. If dispatchToAgent read
  // `activeSessionId` directly, it would always see whatever conversation
  // was active the moment it was defined, not the one active NOW if the user
  // switched conversations in between. Keeping a ref in sync via this
  // useEffect, and reading `.current` from it instead, sidesteps that trap —
  // a ref's `.current` is always read fresh, live, at call time.
  const activeSessionIdRef = useRef(activeSessionId)
  useEffect(() => { activeSessionIdRef.current = activeSessionId }, [activeSessionId])

  // Fetch the FULL reconstructed transcript for one conversation (see
  // app/api/session-history/route.js) — used both on first load and whenever
  // the user switches to a different conversation in the sidebar.
  const fetchHistory = useCallback(async (sid) => {
    setHistoryLoading(true)
    try {
      const data = await fetch(`/api/session-history?sessionId=${sid}`).then(r => r.json())
      setMessages(data.messages?.length ? data.messages : [])
    } catch {}
    setHistoryLoading(false)
  }, [])

  // Fetch the shared, server-side conversation list (see /api/sessions) —
  // this is what every device sees the same way, replacing what used to be
  // a per-browser localStorage list.
  const fetchSessions = useCallback(async () => {
    try {
      const data = await fetch('/api/sessions').then(r => r.json())
      return data.sessions ?? []
    } catch {
      return []
    }
  }, [])

  // Bootstrap on mount — "what conversations exist in this project, and
  // which one was THIS browser last looking at?" The conversation list
  // itself comes from the server (so it's identical on every device); only
  // "which one to open first" is a per-device convenience read from
  // localStorage, and falls back to the most recent conversation (rather
  // than the original reference session) if this browser has no memory of
  // its own — so a new device opening the app lands on the same latest
  // conversation another device would see, not an empty/ancient default.
  useEffect(() => {
    (async () => {
      const list = await fetchSessions()
      setSessions(list)

      const remembered = loadActiveId()
      const initial = (remembered && list.some(s => s.id === remembered))
        ? remembered
        : (list[0]?.id ?? DEFAULT_SESSION_ID)

      setActiveSessionId(initial)
      activeSessionIdRef.current = initial
      saveActiveId(initial)
      fetchHistory(initial)
    })()
  }, [fetchHistory, fetchSessions])

  // Change which conversation is "active" — clears the message list (so old
  // messages don't flash briefly before the new conversation's history
  // loads) and kicks off fetchHistory for the newly-selected one.
  const switchSession = useCallback((sid) => {
    if (sid === activeSessionIdRef.current) return
    setActiveSessionId(sid)
    setMessages([])
    setLastTurnUsage(null)
    setInput('')
    saveActiveId(sid)
    fetchHistory(sid)
  }, [fetchHistory])

  // Shared by "New" (empty new conversation) and "Rerun" (new conversation
  // that immediately replays a prior prompt) — returns the new session id
  // (or null on failure) so callers can chain a dispatchToAgent onto it.
  const createSessionAndSwitch = useCallback(async () => {
    if (creatingSession) return null
    setCreatingSession(true)
    let newSessionId = null
    try {
      const res  = await fetch('/api/session/new', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ refSessionId: activeSessionIdRef.current }),
      })
      const data = await res.json()
      if (!data.sessionId) throw new Error('No session ID returned')

      // The new session already exists server-side the instant /api/session/new
      // returns (so /api/sessions would already include it too) — prepending
      // it here directly just avoids an extra round-trip/flicker before it
      // shows up in the sidebar.
      const newEntry = { id: data.sessionId, createdAt: data.createdAt ?? new Date().toISOString(), name: '', pinned: false }
      setSessions(prev => [newEntry, ...prev])
      saveActiveId(data.sessionId)
      // Sync the ref synchronously (not just the state setter) so an
      // immediately-following dispatchToAgent call targets the new session
      // rather than a stale value from before this render commits.
      activeSessionIdRef.current = data.sessionId
      setActiveSessionId(data.sessionId)
      setMessages([])
      setLastTurnUsage(null)
      setInput('')
      setHistoryLoading(false)
      newSessionId = data.sessionId
    } catch (err) {
      console.error('Failed to create session:', err)
    }
    setCreatingSession(false)
    return newSessionId
  }, [creatingSession])

  const createNewSession = useCallback(() => createSessionAndSwitch(), [createSessionAndSwitch])

  // Runs once, after hydration — safe to read localStorage here since this
  // never executes server-side, so there's nothing for it to mismatch against.
  useEffect(() => {
    try {
      if (localStorage.getItem('bi_dark') === '1') setDarkMode(true)
    } catch {}
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    try { localStorage.setItem('bi_dark', darkMode ? '1' : '0') } catch {}
  }, [darkMode])

  const toggleDark = useCallback(() => setDarkMode(d => !d), [])

  // Renaming/pinning update the local list immediately (so the UI feels
  // instant) and persist to the session's own title/metadata on the server
  // (see /api/session-update) so the change is visible from any other
  // device the next time it loads /api/sessions — not just this browser.
  const renameSession = useCallback((id, name) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, name } : s))
    fetch('/api/session-update', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sessionId: id, name }),
    }).catch(() => {})
  }, [])

  const pinSession = useCallback((id) => {
    // Read the current value from state directly (rather than computing it
    // inside the setSessions updater) to avoid relying on that updater
    // running exactly once — React may invoke it more than once in dev.
    const nextPinned = !sessions.find(s => s.id === id)?.pinned
    setSessions(prev => prev.map(s => s.id === id ? { ...s, pinned: nextPinned } : s))
    fetch('/api/session-update', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sessionId: id, pinned: nextPinned }),
    }).catch(() => {})
  }, [sessions])

  // Permanently deletes one or more conversations (see /api/session-delete
  // — a real deletion on Anthropic's platform, not just hiding it locally).
  // If the currently-open conversation is among the ones deleted, switches
  // to whatever's left rather than leaving the UI pointed at a conversation
  // that no longer exists.
  const deleteSessions = useCallback(async (ids) => {
    const idSet = new Set(ids)
    try {
      await fetch('/api/session-delete', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionIds: ids }),
      })
    } catch {}
    const remaining = sessions.filter(s => !idSet.has(s.id))
    setSessions(remaining)
    if (idSet.has(activeSessionIdRef.current)) {
      const next = remaining[0]?.id ?? DEFAULT_SESSION_ID
      switchSession(next)
    }
  }, [sessions, switchSession])

  const fetchSessionFiles = useCallback(async () => {
    setFetching(true)
    try {
      const res   = await fetch(`/api/session-files?sessionId=${activeSessionIdRef.current}`)
      const data  = await res.json()
      const files = data.files ?? []
      setSessionFiles(files)
      setFetched(true)
      // Persist readiness status on the session (server-side, via
      // /api/session-update) so every device's sidebar can show the same
      // readiness dot for this conversation, not just this browser's.
      const hasSpec  = files.some(f => f.name === 'dashboard_spec.json')
      const hasModel = files.some(f => f.name === 'semantic_model.json')
      const fileStatus = { hasSpec, hasModel }
      setSessions(prev => prev.map(s =>
        s.id === activeSessionIdRef.current ? { ...s, fileStatus } : s
      ))
      fetch('/api/session-update', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionId: activeSessionIdRef.current, fileStatus }),
      }).catch(() => {})
    } catch {}
    setFetching(false)
  }, [])

  // The "Build PBIP" action from SessionItem: sends the two AI-authored IR
  // files to the SEPARATE, deterministic `builder` service (a different app
  // entirely — see builder/app.py) which turns them into real Power BI
  // project files and streams back a downloadable .zip. This is the payoff
  // moment of the whole pipeline: everything before this button was
  // planning and drafting; this is where a real, usable artifact is
  // produced.
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
      // Trim verbose jsonschema dumps — first line is the human-readable reason
      const msg = (e.message ?? '').split('\n')[0].slice(0, 200)
      setPbipError(msg || 'Build failed')
    }
    setBuildingPbip(false)
  }, [sessionFiles])

  // On mount, try to resume a previously-connected report folder (see
  // lib/localWrite.js) — `queryPermission` (unlike `requestPermission`)
  // doesn't need a user gesture, so this can safely run automatically and
  // just tell us whether the user will need to click "Reconnect" or not.
  useEffect(() => {
    const supported = localWrite.isSupported()
    setReportFolderSupported(supported)
    if (!supported) return
    localWrite.loadSavedHandle().then(async (handle) => {
      if (!handle) return
      setReportFolderHandle(handle)
      setReportFolderName(handle.name)
      const granted = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted'
      setReportFolderReady(granted)
    })
  }, [])

  const connectReportFolder = useCallback(async () => {
    try {
      const handle = await localWrite.pickReportFolder()
      setReportFolderHandle(handle)
      setReportFolderName(handle.name)
      setReportFolderReady(true)
      setApplyResult(null)
      setApplyError(null)
    } catch (e) {
      // AbortError just means the user closed the picker without choosing
      // anything — not a real error worth surfacing.
      if (e?.name !== 'AbortError') setApplyError(e.message ?? String(e))
    }
  }, [])

  const reconnectReportFolder = useCallback(async () => {
    if (!reportFolderHandle) return
    try {
      const ok = await localWrite.ensurePermission(reportFolderHandle)
      setReportFolderReady(ok)
    } catch (e) {
      setApplyError(e.message ?? String(e))
    }
  }, [reportFolderHandle])

  const disconnectReportFolder = useCallback(() => {
    localWrite.clearSavedHandle()
    setReportFolderHandle(null)
    setReportFolderName(null)
    setReportFolderReady(false)
    setApplyResult(null)
    setApplyError(null)
  }, [])

  // The direct-write counterpart to buildPbip: same two IR files, but
  // instead of downloading a zip, fetches a JSON manifest (see builder/
  // app.py's /api/build-manifest) and writes/merges it straight into the
  // connected local folder via lib/localWrite.js.
  const applyToFolder = useCallback(async () => {
    const specFile  = sessionFiles.find(f => f.name === 'dashboard_spec.json')
    const modelFile = sessionFiles.find(f => f.name === 'semantic_model.json')
    if (!specFile || !modelFile || !reportFolderHandle) return
    setApplyingToFolder(true)
    setApplyError(null)
    setApplyResult(null)
    try {
      const res = await fetch(
        (process.env.NEXT_PUBLIC_BICOHOST_URL ?? '') + '/api/build-manifest',
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dashboard_spec: JSON.parse(specFile.content),
            semantic_model: JSON.parse(modelFile.content),
            build_id: Date.now().toString(36),
          }),
        }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      const manifest = await res.json()
      const result = await localWrite.applyManifest(reportFolderHandle, manifest)
      setApplyResult(result)
    } catch (e) {
      const msg = (e.message ?? '').split('\n')[0].slice(0, 200)
      setApplyError(msg || 'Apply failed')
    }
    setApplyingToFolder(false)
  }, [sessionFiles, reportFolderHandle])

  // Reset file state on session switch
  useEffect(() => {
    setSessionFiles([])
    setFetched(false)
    setPbipError(null)
    setApplyResult(null)
    setApplyError(null)
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
  }, [messages, agentStatus, liveNarration])


  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }, [])

  // ==========================================================================
  // Core send — builds the streaming loop, used by sendMessage and regenerateFiles
  // ==========================================================================
  // This is the browser-side twin of app/api/chat/route.js's server-side SSE
  // producer — one writes the live event stream, this reads it. It POSTs the
  // user's message to our own `/api/chat` endpoint, then manually reads the
  // HTTP response body as a raw byte stream (`res.body.getReader()`) rather
  // than waiting for a normal, complete response — that's what lets replies,
  // narration, and "thinking" indicators appear on screen progressively,
  // in real time, instead of all at once after everything finishes.
  //
  // CONCEPT: Decoding a raw byte stream into discrete SSE messages
  // -------------------------------------------------------------------------
  // Network data doesn't arrive in neat, complete messages — a single chunk
  // read from the stream might contain half of one event and all of the
  // next. `buf` accumulates bytes across reads; splitting on `\n\n` (the SSE
  // message separator, see app/api/chat/route.js's `send` helper) pulls out
  // every COMPLETE message so far, while any trailing partial message is put
  // back into `buf` to be finished off by the next chunk that arrives.
  const dispatchToAgent = useCallback(async (text) => {
    setAgentStatus('thinking')
    setThinkHint('thinking')
    turnUsageAccum.current = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    turnNarrationAccum.current = []
    setLiveNarration([])

    const userMsg  = { role: 'user',  text, time: ts(), id: Date.now() }
    const agentId  = Date.now() + 1
    const agentMsg = { role: 'agent', text: '', time: ts(), id: agentId, streaming: true }
    setMessages(prev => [...prev, userMsg, agentMsg])

    try {
      const res = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: text, sessionId: activeSessionIdRef.current }),
      })

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      // CONCEPT: A stream can end WITHOUT ever sending a 'done'/'error'
      // -----------------------------------------------------------------
      // The server-side connection can be cut off abruptly — most
      // concretely, if a turn runs long enough to hit the server's own
      // maxDuration limit (see app/api/chat/route.js), the hosting platform
      // kills that request mid-stream with no chance for it to send a
      // final message first. `reader.read()` still reports `done: true`
      // when that happens (the connection just closed), so the loop below
      // would otherwise exit silently, leaving the UI frozen forever on
      // "thinking" with a permanently blank streaming bubble — exactly the
      // stuck state this flag exists to catch and recover from.
      let reachedTerminal = false

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
            // Generic or subagent-specific "working on it" hint (see
            // SUBAGENT_HINTS server-side) — drives the ThinkingBubble text.
            setAgentStatus('thinking'); setThinkHint(data.hint || 'thinking')
          } else if (data.type === 'tool') {
            setAgentStatus('thinking'); setThinkHint(data.name ? `Using ${data.name}` : 'tool')
          } else if (data.type === 'narration') {
            // One more "what a specialist just did/said" line — appended to
            // the accumulator AND immediately reflected into `liveNarration`
            // state so it's visible right away, not just once the whole
            // turn finishes.
            const line = { agent: data.agent, text: data.text, time: ts() }
            turnNarrationAccum.current = [...turnNarrationAccum.current, line]
            setLiveNarration(turnNarrationAccum.current)
          } else if (data.type === 'usage') {
            // Token counts from one individual model call — accumulated
            // silently (no visible UI change per event) until 'done', when
            // the running total becomes this turn's final usage badge.
            const a = turnUsageAccum.current
            a.input    += data.input    ?? 0
            a.output   += data.output   ?? 0
            a.cacheRead  += data.cacheRead  ?? 0
            a.cacheWrite += data.cacheWrite ?? 0
          } else if (data.type === 'message') {
            // The coordinator's reply text, RE-SENT WHOLE each time it grows
            // (not incremental deltas) — simplest possible way to render a
            // streaming reply: just keep replacing the bubble's full text
            // with whatever the latest snapshot is.
            setAgentStatus('streaming')
            setMessages((prev) =>
              prev.map((m) => (m.id === agentId ? { ...m, text: data.text } : m))
            )
          } else if (data.type === 'done') {
            // The turn is genuinely over — freeze the accumulated usage and
            // narration onto the message permanently (so it's still there
            // after a page reload, matching what session-history/route.js
            // would reconstruct), then clear the "live" versions since
            // there's no longer an in-progress turn to show them for.
            const finalUsage = { ...turnUsageAccum.current }
            const finalNarration = [...turnNarrationAccum.current]
            setLastTurnUsage(finalUsage)
            setMessages((prev) =>
              prev.map((m) => (m.id === agentId ? { ...m, streaming: false, usage: finalUsage, narration: finalNarration } : m))
            )
            turnNarrationAccum.current = []
            setLiveNarration([])
            setAgentStatus('idle')
            reachedTerminal = true
          } else if (data.type === 'error') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === agentId
                  ? { ...m, text: `[Error: ${data.message}]`, streaming: false, error: true }
                  : m
              )
            )
            turnNarrationAccum.current = []
            setLiveNarration([])
            setAgentStatus('idle')
            reachedTerminal = true
          }
        }
      }

      // The connection closed without ever telling us the turn finished or
      // failed — most likely the server's own time limit killed it mid-run
      // (see the CONCEPT note above). Surface that plainly and release the
      // UI back to idle, rather than leaving it stuck "thinking" forever
      // with no way to send another message.
      if (!reachedTerminal) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentId
              ? { ...m, text: '[Connection ended before the run finished — it may have exceeded the server time limit. Try again, or send a follow-up.]', streaming: false, error: true }
              : m
          )
        )
        turnNarrationAccum.current = []
        setLiveNarration([])
        setAgentStatus('idle')
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === agentId
            ? { ...m, text: `[Network error: ${err.message}]`, streaming: false, error: true }
            : m
        )
      )
      turnNarrationAccum.current = []
      setLiveNarration([])
      setAgentStatus('idle')
    }
  }, [])

  // Replays a prior structured prompt in a brand-new conversation — the
  // closest equivalent to a "regenerate" button this app can support, since
  // Managed Agents sessions have no fork/rewind primitive to regenerate a
  // later turn in place (see the "rerun" plan for why).
  const rerunPrompt = useCallback(async (text) => {
    if (agentStatus !== 'idle') return
    const sid = await createSessionAndSwitch()
    if (sid) await dispatchToAgent(text)
  }, [agentStatus, createSessionAndSwitch, dispatchToAgent])

  // Handles the send button / Enter key. The FIRST message of a brand new
  // conversation is built differently from every later one: it stitches
  // together the schema textarea, the business-context textarea, any
  // attached files, and whatever's typed in the main input box into ONE
  // long, clearly-labeled block of text (see the "## DATA MODEL SCHEMA" /
  // "## BUSINESS CONTEXT" headers below) — this is the exact shape
  // bi-planner's job description (bi-planner.agent.yaml) expects to receive
  // as its very first input. Every message after that is just sent as
  // plain, unstructured text, the same as any normal chat turn.
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
    await dispatchToAgent(text)
  }, [input, agentStatus, schema, context, attachedFiles, messages, dispatchToAgent])

  // The "Generate missing files →" recovery action shown when a conversation
  // ended without producing dashboard_spec.json/semantic_model.json (e.g.
  // the agent got sidetracked, or the user's brief was still being refined).
  // Rather than a special-purpose code path, this just sends ANOTHER plain
  // chat message asking the agent to catch up — the same mechanism as any
  // normal user turn, demonstrating that "the agent skipped a step" is
  // recoverable with an ordinary follow-up instruction, not a special reset.
  const regenerateFiles = useCallback(async (missingFiles) => {
    if (agentStatus !== 'idle') return
    const list = missingFiles.map(f => `- ${f}`).join('\n')
    const text = `Please review our conversation above and generate the missing pipeline files.\n\nWrite the following to /mnt/session/outputs/:\n${list}\n\nFollow your skill file exactly for the correct schemas and conventions. Run the completion gate (ls /mnt/session/outputs/) before ending your turn.`
    await dispatchToAgent(text)
  }, [agentStatus, dispatchToAgent])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const isIdle     = agentStatus === 'idle'
  const isSetup    = messages.length === 0
  const currentSession      = sessions.find(s => s.id === activeSessionId)
  const activeSessionFallback = sessionFallbackName(sessions, activeSessionId)
  const hasContent = isSetup
    ? Boolean(schema.trim() || context.trim() || attachedFiles.length > 0 || input.trim())
    : Boolean(input.trim())

  const showThinking = (agentStatus === 'thinking' || thinkHint === 'tool') &&
    messages[messages.length - 1]?.role !== 'agent'

  // The overall page layout: a fixed-width Sidebar on the left, the main
  // conversation column in the middle (header, scrolling message list,
  // input box), and the file PreviewPanel that slides out from the right
  // only when a file is selected — three siblings in one horizontal flex
  // row, matching the three-pane look of the rendered screenshot.
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
        onDeleteSessions={deleteSessions}
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
        onRegenerateFiles={regenerateFiles}
        darkMode={darkMode}
        onToggleDark={toggleDark}
        onRenameSession={renameSession}
        onPinSession={pinSession}
        reportFolderSupported={reportFolderSupported}
        reportFolderName={reportFolderName}
        reportFolderReady={reportFolderReady}
        onConnectFolder={connectReportFolder}
        onReconnectFolder={reconnectReportFolder}
        onDisconnectFolder={disconnectReportFolder}
        onApplyToFolder={applyToFolder}
        applyingToFolder={applyingToFolder}
        applyResult={applyResult}
        applyError={applyError}
      />

      {/* ── MAIN ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Conversation header — height mirrors sidebar agent-info to align the visual break */}
        <div className="flex-shrink-0 flex items-center px-6 border-b border-ink/10 min-h-[64px]">
          <div className="max-w-2xl w-full mx-auto">
            <ConversationHeader
              name={currentSession?.name ?? ''}
              fallback={activeSessionFallback}
              onRename={(name) => renameSession(activeSessionId, name)}
            />
          </div>
        </div>

        {/* Messages */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-6 pt-6 pb-8">

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
                msg.role === 'user'      ? <UserMessage       key={msg.id} msg={msg} onRerun={rerunPrompt} isIdle={isIdle} /> :
                msg.role === 'compacted' ? <CompactionMarker  key={msg.id} msg={msg} /> :
                                           <AgentMessage      key={msg.id} msg={msg} />
              )}
              {liveNarration.length > 0 && <LiveNarration entries={liveNarration} />}
              {showThinking && <ThinkingBubble hint={thinkHint} />}
            </div>

            <div ref={bottomRef} />
          </div>
        </div>

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
