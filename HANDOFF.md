# Handoff — 2026-07-06

Session focus: turning the `agent/` chat app's single Managed Agent into a real
coordinator + subagent (bi-planner / bi-design / bi-authoring) pipeline, giving it
shared memory across runs, and adding visibility/control features to the chat UI.
Everything below is pushed to `main` — working tree is clean.

## What shipped this session (4 commits, newest first)

1. **`05dba29` — Rerun button.** Hover over the initial data-model+context message →
   retry icon → spins up a brand-new conversation and resends that exact prompt
   verbatim. Not a true "regenerate in place" (see constraint below) — always creates a
   new conversation, original is left untouched for comparison. Also fixed a
   cache-hit-rate display bug on individual message footers (was dividing cache-read
   tokens by input tokens alone instead of input+cache-read → showed values like
   "483975% cached").
2. **`a6aa462` — Inline subagent narration**, replacing the old side "Activity Log"
   panel entirely. Each subagent's own `agent.message`/`agent.tool_use` events never
   reached the primary session stream (confirmed live) — the old panel could only ever
   show the coordinator's own tool calls. Now each subagent thread gets its own event
   stream (`chat/route.js`), narration streams inline in the chat as it happens and
   collapses into a "▸ N steps" toggle once the turn finishes; `session-history/route.js`
   reconstructs the same thing for reloaded conversations.
3. **`d287180` — Per-conversation time/cost tracking.** Sidebar now shows elapsed
   wall-clock time + $ cost, broken down per agent (`agent/lib/pricing.js`,
   `/api/session-usage`). Pricing is expiry-aware (Sonnet 5 intro rate $2/$10 per MTok
   ends 2026-08-31 per `shared/model-migration.md` — after that it's $3/$15).
4. **`f9b627c` — Fixed the shared memory store.** Two stacked bugs, found via a live
   A/B verification (same brief run twice): (a) `bi-design`/`bi-authoring` had no
   `glob`/`grep` tools, so they could only guess lesson filenames in
   `/mnt/memory/bi-pipeline-lessons/` and guessed wrong — fixed by adding both tools +
   broadening the memory-read instructions in their system prompts (`agent-configs/*.yaml`,
   applied via `agent-configs/fix_memory_read.py`). (b) **Bigger bug**: the coordinator's
   `multiagent.agents` roster pinned exact subagent **versions**
   (`{type:"agent", id, version:1}`), so *every* prior config update to bi-design/
   bi-authoring had been silently inert. Fixed by re-pointing the roster at plain agent-ID
   strings (unpinned → always resolves to latest version). **Remember this if subagent
   prompt/tool changes ever seem to have no effect again** — check
   `client.beta.agents.retrieve(COORDINATOR_ID).multiagent` for accidental version pins
   before assuming the change itself is wrong.

   Verified after the fix: same test brief, first `validate_ir` attempt → `valid: true`,
   zero repeated mistakes (previously took up to 6 attempts across two schema-shape
   errors). ~5x cheaper/faster as a result (see commit for numbers).

## Known limitations (flagged, not fixed — don't rediscover these as "new" bugs)

- **Browser-disconnect mid-turn hangs the session.** If the SSE-listening client
  disconnects while a `validate_ir` custom-tool call is pending, the session sits in
  `requires_action` forever — no automatic reconnect/resume exists. Has to be resolved
  manually (call the real `/api/validate` and send `user.custom_tool_result` via the
  SDK directly). Ran into this live a couple of times this session.
- **Local dev needs `NEXT_PUBLIC_BICOHOST_URL` set** in `agent/.env.local` or
  `validate_ir` fails locally with `{"valid":false,"error":"Failed to parse URL from
  /api/validate"}` (a relative path with no base URL). This is a local-dev-only gap —
  production should already have this set (see README's env var table) but wasn't
  independently re-verified this session.
- **Vercel production deploy not independently confirmed for this session's pushes.**
  Tried to check via the Vercel MCP tool and got a 403 (insufficient permission on that
  token to list deployments). The `agent/` project's git integration auto-deploys on
  push to `main` per earlier-session verification, but if the chat UI looks stale after
  pulling this, check the Vercel dashboard directly for the latest deployment status.

## Key IDs (so a fresh session doesn't have to re-derive these)

- Coordinator agent: `agent_01HRthjDm1bhdTXAqG8UBAK5` ("BI Requirements & Wireframe Agent")
- Subagents: bi-planner `agent_016bjEDxxuKfgpR1kgyGeVij` · bi-design
  `agent_01Auw9HmVhn71m97DEwPGkui` (v3) · bi-authoring `agent_014pXjcphcdvysd5PQKhyBBf` (v3)
- Shared memory store: `memstore_01LvjHnGpcRYxQMFXE2UXFoU` (`BI_LESSONS_MEMORY_STORE_ID`
  in `.env.local` — gitignored, must be set again on any new machine/clone)
- Reference session (agent/environment source for new sessions): `sesn_01S3zW6pLxWnwyxZ9rmB6tZB`

## Picking this up on a different machine

1. `git clone`/`pull` this repo, `cd agent && npm install`.
2. Recreate `agent/.env.local` — see README.md's env var table, plus
   `BI_LESSONS_MEMORY_STORE_ID` above (not in README, added this session).
3. `npm run dev` → `http://localhost:3000`.
4. This file + `builder/PICKUP.md` (separate, Windows/Gate-2-focused) are the two
   handoff docs in this repo — `builder/PICKUP.md`'s "Open work" list (TMDL merge, more
   visual skills, etc.) is unrelated to this session and still pending.

## Not done / explicitly out of scope this session

- Fabric publish — still deliberately excluded per standing instruction in
  `builder/PICKUP.md`; don't add without being asked again.
- `builder/PICKUP.md`'s open items (skill→semantic-model TMDL merge, more skills,
  Desktop-bridge automation) — untouched this session, still open.
