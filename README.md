# BI Pipeline — Monorepo

Two services that work together to turn a plain-text brief into a deployable Power BI report.

```
User brief + schema
        │
        ▼
[ agent/ ]  ←→  claude-agent-chat-silk.vercel.app
   Managed Agent session (Anthropic)
   Emits: dashboard_spec.json, semantic_model.json, wireframe.html
        │ "Build PBIP ↓" button
        ▼
[ builder/ ]  ←→  bi-cohost.vercel.app/api/build
   Deterministic Python: ingest → validate → PBIR pages
   Returns: pages_{id}.zip  (+tmdl/ fragments when skills need model objects)
        │
        ▼
MyReport.Report/definition/pages/  ← extract zip here
        │
        ▼
Power BI Desktop  (reopen .pbip → pages appear)
```

## Structure

| Directory | Language | Vercel Project | Role |
|---|---|---|---|
| `builder/` | Python / Flask | bi-builder | IR → PBIR pages (deterministic, no LLM) |
| `agent/` | Next.js | bi-agent | Chat UI + Managed Agent session |
| `contracts/` | Markdown | — | Shared interface spec (AGENT_CONTRACT.md) |

## Deploying

Each sub-project deploys independently. In each Vercel project, set **Root Directory** to the matching subdirectory:

- **bi-builder** → Root Directory: `builder`
- **bi-agent** → Root Directory: `agent`

### Required environment variables

**bi-builder** (`builder/`):
| Variable | Value |
|---|---|
| `ARTIFACT_ROOT` | `/tmp/bi-cohost-builds` |

**bi-agent** (`agent/`):
| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your key |
| `REFERENCE_SESSION_ID` | the seeded agent session ID (server-side) |
| `NEXT_PUBLIC_REFERENCE_SESSION_ID` | same value (client-side bootstrap) |
| `NEXT_PUBLIC_BICOHOST_URL` | `https://<your-builder-deployment>.vercel.app` |

## Shared interface

See `contracts/AGENT_CONTRACT.md` for the full field spec.

The agent emits two JSON artifacts. The builder consumes them:
- `dashboard_spec.json` — pages, visuals, grid positions, skill references
- `semantic_model.json` — measures (DAX), dimensions, relationships

## Working with skills

Visual skills live in `builder/pbi-skills/<name>/`. Each skill is a directory with:
- `SKILL.md` — frontmatter (name, description) + token table
- `templates/` — `*.visual.json` and `*.tmdl` with `<TOKEN>` placeholders
- `examples/` — worked example

Skills with `.tmdl` templates produce TMDL fragments in the zip under `tmdl/`. Copy those files into `<YourReport>.SemanticModel/definition/tables/` before reopening in Desktop.

## Development

```bash
# Builder
cd builder
python3 -m pytest tests/ -q
python3 -m http.server  # or: python3 app.py

# Agent
cd agent
npm install
npm run dev  # http://localhost:3000
```

## Gates

| Gate | When | How |
|---|---|---|
| Gate 1 | builder/ingest | JSON Schema validation on both inputs |
| Gate 1b | builder/pbip_builder | All generated JSON files parse cleanly |
| Gate 2 | manual (Windows) | Open generated PBIP in Power BI Desktop |
| Gate 3 | builder/pbip_builder | IR fidelity: page/visual counts + pixel positions |
