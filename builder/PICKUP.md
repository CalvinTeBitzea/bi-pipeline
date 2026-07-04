# Pick up here (on the Power BI machine)

**State (2026-06-26):** the builder half is complete, proven offline, and **deployed as a live
web API** at `https://bi-cohost.vercel.app/api/build`. The BI-Workflow agent app is also live
at `https://claude-agent-chat-silk.vercel.app`. The two halves are now wired together via a
"Build PBIP ↓" button in the agent app's Output Files panel.

**Your task on this machine:** run Gate 2 — open the generated PBIP in Power BI Desktop and
confirm pages render. You do not need to touch any code.

---

## The full workflow (end-to-end test)

### Step 1 — Prepare a stub dataset in Power BI Desktop

You need a Desktop report connected to a dataset whose **table and column names match the
`semantic_model.json`** you're building against. Real data is not required — a stub dataset
with the right schema and zero or a few dummy rows is enough for Gate 2.

For the **retail example** (`examples/retail/semantic_model.json`), the tables are:
`Fact_Sales`, `Dim_Product`, `Dim_Category`, `Dim_Customer`, `Dim_Date`.
Create an Excel file (or CSV set) with those sheet/file names and at least the column headers
that appear in `semantic_model.json`. Connect it in Desktop as a local data source.

Then:
1. Desktop → **Options → Preview features → enable "Store reports using enhanced metadata
   format (PBIR)"** (required once per machine).
2. Connect the stub dataset → **File → Save as → Power BI Project (.pbip)**.
3. Note the path to the `.Report` folder, e.g. `C:\Reports\MyReport.Report`.
4. **Close Desktop** before the next step.

### Step 2 — Generate the pages via the web app (recommended path)

1. Open `https://claude-agent-chat-silk.vercel.app` in your browser.
2. Paste your schema and brief → run the agent → wait for it to finish.
3. Click **Fetch** in the sidebar → Output Files panel shows
   `dashboard_spec.json`, `semantic_model.json`, `wireframe.html`.
4. Click **Build PBIP ↓** → `pages_XXXX.zip` downloads automatically.
5. Extract the zip. You'll get folders like `pg01.../`, `pg02.../` and a `pages.json`.
6. Copy all extracted contents into `MyReport.Report\definition\pages\`
   (clear any existing content in that folder first).
7. Reopen `MyReport.pbip` in Desktop → new pages appear.

### Step 2 (alternative) — Use the CLI directly

If you prefer to skip the web app and test with the known-good retail example:

```powershell
.\setup.ps1                         # first time only
.\run.ps1 `
  --wireframe-spec examples\retail\dashboard_spec.json `
  --semantic-model examples\retail\semantic_model.json `
  --build-id retail_demo `
  --pbip-path "C:\path\to\MyReport.Report"
```

Reopen `MyReport.pbip` → pages appear.

### Step 3 — Validate (Gate 2 checklist)

- [ ] Pages exist in Desktop (correct count, correct names)
- [ ] Visuals are positioned at the wireframe layout (check against `wireframe.html`)
- [ ] Field bindings resolve — no "Can't load visual" if the stub data columns match
- [ ] Pareto combo chart (if present) renders with both bar and line series
- [ ] Walk `pbi-skills/line-column-combo-chart/SKILL.md` → Validation section
- [ ] Walk `pbi-skills/time-window-highlight/SKILL.md` → Validation section (skill warns
      about missing TMDL objects — this is expected; see Open work #1 below)

---

## Architecture recap

```
[BI-Workflow agent app]  ←→  claude-agent-chat-silk.vercel.app
        │ emits
        ▼
dashboard_spec.json + semantic_model.json
        │
        ▼  "Build PBIP ↓" button  (or CLI: run.ps1 --pbip-path)
        │
[bi-cohost API]  ←→  bi-cohost.vercel.app/api/build
        │ returns pages zip
        ▼
MyReport.Report/definition/pages/   ←  extract zip here
        │
        ▼
Power BI Desktop  (open MyReport.pbip)
```

**What the web API does NOT generate:** the `.platform`, `report.json`, `version.json`, and
`.SemanticModel` files — Desktop owns those. That's why you need the existing `.Report` folder
as the injection target. The API returns only the `pages/` content.

---

## What this repo is

bi-cohost is the **builder half** of the BI-Workflow pipeline. The contract between the two
halves is **`../contracts/AGENT_CONTRACT.md`** (read this for field-name conventions; the
brand/design contract is **`../contracts/HOUSE_DESIGN_BRIEF.md`**).
A complete, buildable example is in **`examples/retail/`**.

## microsoft/skills-for-fabric integration (2026-07-04)

Official Microsoft CLIs/skills (`@microsoft/powerbi-report-authoring-cli`,
`@microsoft/powerbi-desktop-bridge-cli`) are now the source of truth for PBIR mechanics
instead of hand-guessed schema versions. What changed:

- **House theme + FHD canvas.** Every report now inherits the house design identity
  (Editorial Newsroom tone) — see `../contracts/HOUSE_DESIGN_BRIEF.md` and
  `pbi-theme/HouseEditorial-ca31b320.json`. Canvas moved from `1280x720` to FHD `1920x1080`
  (`lib/layout.py`), and `pbip_builder.py` now registers the theme into `report.json` +
  `StaticResources/RegisteredResources/` on every build (`_register_house_theme`).
- **Gate 1b.** `powerbi-report-author validate` now runs automatically (when `--pbip-path` is
  given) as an extra gate alongside Gate 1/3 — install with
  `npm install -g @microsoft/powerbi-report-authoring-cli`. Degrades gracefully (skips with a
  message, doesn't fail the build) if the CLI isn't installed.
- **Schema version consistency fix.** The two `pbi-skills/` had drifted to *different*
  hardcoded `$schema` versions (2.8.0 vs 2.9.0) inside their own templates. Every visual in a
  build — skill-built or fallback — is now forced to the one resolved `schema_url` (bumped
  fallback default to 2.9.0), matching what `powerbi-report-author` expects.
- **Found and fixed via Gate 1b:** the `scatter` visual type's fallback path
  (`_build_query_state`'s catch-all branch) was schema-invalid — it dumped all measures into
  `Y` and never populated the required `X` role. `catalog describe scatterChart` showed it needs
  distinct `X`/`Y`/`Size`/`Category` roles (field-order convention: `measures[0]`=X,
  `measures[1]`=Y, `measures[2]`=Size). This was real breakage in the existing retail example,
  not hypothetical — now fixed with a dedicated `scatterChart` branch + a regression test
  (`test_scatter_uses_x_y_size_roles_not_category_y_fallback`) and a Gate 1b assertion test.
- **Found, not yet fixed: `time-window-highlight` only half-renders.** This skill's template
  set produces *two* `.visual.json` outputs (the line chart + a disconnected-slicer). But
  `pbip_builder.py`'s `run()` only takes `built_visuals[0]` per IR visual entry — the second
  visual (the slicer) is silently discarded. Confirmed by filling the skill directly and
  inspecting `_skill_outputs`'s return value: 2 visuals produced, only 1 ever reaches disk. Not
  caught by Gate 1b because a single valid `lineChart` visual with no slicer is still
  schema-valid — it's a completeness bug, not a validation-shaped one. This overlaps with open
  item #2 below (the skill only really works once semantic-model TMDL merge exists, since the
  slicer needs its own disconnected table) — fixing both together is probably the efficient
  order.
- **Dead code removed:** `agents/requirements.py`, `agents/semantic_model.py` (pre-pivot,
  unreferenced by `conductor.py`), `schemas/requirements.json`, `docs/AGENT_CONTRACT.md`
  (byte-identical stale duplicate of `../contracts/AGENT_CONTRACT.md`), and `templates/`
  (unreferenced leftover archetype concept).
- **Not verified: Desktop rendering.** Everything above is confirmed via
  `powerbi-report-author validate` (schema-level) and the test suite — nobody has opened the
  house-themed, FHD-canvas output in actual Power BI Desktop yet. Validate does not catch
  misrender. This still needs a real Gate 2 pass on the Windows machine per the workflow below
  before calling the design layer "done," not just "schema-valid."

## Open work (in priority order)

1. **`time-window-highlight` only half-renders (multi-visual skill output dropped).** See
   above — `pbip_builder.py::run()` only writes `built_visuals[0]` per IR visual entry, so
   this skill's slicer never reaches disk. Probably fix together with item 3 below (TMDL
   merge), since the slicer's disconnected table depends on that merge existing anyway.
2. **More skills.** Only two exist (`line-column-combo-chart`, `time-window-highlight`; scatter
   was a fallback bug, now fixed — see above). Add donut, ranked-table, KPI card. Use
   `powerbi-report-author catalog describe <type>` / `formatting describe-object` for exact
   roles/properties instead of hand-copying from memory. New skills drop into `pbi-skills/` and
   are referenceable by name with no builder change.
3. **Skill → semantic-model merge.** A skill emits its report visual but its TMDL fragment
   (new measures table / disconnected slicer table) is **not** applied — it just warns
   (`_skill_needs_model_objects` in `agents/pbip_builder.py`). Needed for
   `time-window-highlight`. Plan: token-fill + merge the skill's `.tmdl` into the project's
   SemanticModel, deduped against existing objects — use `semantic-model-authoring`'s TMDL
   guidelines (installed in this session as the `powerbi-authoring:*` skills).
4. **More golden pages.** `examples/retail/` encodes pages 1–2; pages 3–4 follow the same
   pattern if you want a fuller regression fixture.
5. **Desktop-bridge automation (optional, low priority).** `powerbi-desktop reload`/`screenshot`
   could script Gate 2 on the existing Windows machine instead of doing it by hand. Still
   Windows-only (named-pipe bridge to Desktop) — doesn't change with the official CLI. Not
   started.

**Explicitly out of scope (Calvin's call, 2026-07-04): no Fabric publish.** The product only
generates a local `.pbip`/PBIR output — it does not publish to a Fabric workspace and never
should. `powerbi-report-management` (the Microsoft skill that does Fabric REST CRUD) is
deliberately not integrated. Do not add this without Calvin explicitly asking again.

## Map of the code

| Path | Role |
|---|---|
| `app.py` | Vercel Flask entry point — `POST /api/build` |
| `../contracts/AGENT_CONTRACT.md` | agent↔builder interface + visual-type→skill vocabulary |
| `../contracts/HOUSE_DESIGN_BRIEF.md` | house tone/signature/theme brand contract |
| `agents/ingest.py` | validate the two JSONs + snap geometry |
| `agents/pbip_builder.py` | IR → PBIR (skill token-fill + fallback), Gates 1, 1b & 3, theme registration |
| `agents/conductor.py` | CLI: ingest → build (used by `run.ps1`) |
| `lib/artifact_store.py` | file I/O; respects `ARTIFACT_ROOT` env var |
| `lib/layout.py` | snap engine: `grid` band-intent → pixel `layout` (FHD 1920x1080 canvas) |
| `lib/skills.py` | skill registry + token-fill |
| `pbi-theme/` | house theme.json, registered into every build |
| `schemas/` | `dashboard_spec.json` + `semantic_model.json` JSON schemas |
| `pbi-skills/` | skill templates (SKILL.md + visual.json + tmdl) |
| `examples/retail/` | golden reference — buildable end-to-end |
