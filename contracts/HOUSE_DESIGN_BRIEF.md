# House Design Brief

The default design identity every generated report inherits, unless a client
brief explicitly overrides it. Chosen by Calvin (2026-07-04) from the
`powerbi-report-design` tone catalog, evaluated against the actual proof points
this business sells on (5+ years experience, $3M+ cost savings unlocked,
enterprise clients: HSBC, ANZ, Johnson & Johnson, Toll Group). Encodes the
`Design Brief:` contract shape from `powerbi-authoring:powerbi-report-design`
so it can be pasted directly into a per-report brief's
`design_identity` field.

## Why Editorial Newsroom

Reads like a polished board/exec report rather than generic BI-tool output —
fits a consultancy whose proof points are financial (cost savings, enterprise
logos) and whose buyers are often reading this in an executive review, not
building it themselves. The alternative candidates considered were **Corporate
Cool** (safer, more generic B2B-SaaS default) and **Industrial Dense** (fits an
analyst audience, not an exec one) — see the tone-catalog comparison presented
2026-07-04.

## Design identity

```yaml
Design Brief:
  generated_by: powerbi-report-design
  contract_version: 1
  design_identity:
    tone: Editorial Newsroom
    signature: "Display serif headlines + tabular numerals on KPIs (S2 + S1)"
```

## Downstream choices (from `tone-catalog.md` § Editorial Newsroom)

| Aspect | House default |
|---|---|
| Display typography | Serif — **Georgia** (PBI-guaranteed fallback; catalog names like Source Serif Pro are not) — 28-48pt for page-title textboxes |
| Body typography | Sans — Segoe UI, 11-13pt |
| Surface | Cream `#FAF7F0` (page canvas); visual containers stay white `#FFFFFF` to layer on top |
| Accent | **Black `#0F172A`** — chosen over the catalog's mustard `#D4A30A` alternative because it's Calvin's existing site brand token (`--c-accent` / `--c-cta-primary` in `css/style.css`); mustard is kept as `dataColors[1]`, a secondary/highlight hue |
| Text | Near-black `#1A1A1A` — matches the site's `--c-text` token |
| Density / ratio | 1.500 (Perfect Fifth) — strong hierarchy |
| Gridlines | None on any chart (`categoryAxis.gridlineShow` / `valueAxis.gridlineShow` = `false`) |
| Borders | None on any visual (`border.show` = `false` universally); no section-divider hairlines yet — see Known gaps |
| Iconography | Outlined hairline (1px), restrained — apply at per-visual authoring time, not encoded in theme.json |

## Signature mechanics (S2 + S1)

- **S2 (display serif headlines):** `textClasses.title.fontFace` = Georgia (visual-container titles, 14pt). The *big* 28-48pt page-hero headline is **not** a theme-level concept — it's a per-page `textbox` visual placed in the header band (row 0 of the grid) at authoring time. Every generated page must carry one.
- **S1 (tabular numerals):** Power BI has no reliable theme-level tabular-figure control (per the skill's own guidance) — this is enforced as *authoring intent*, not a theme property. `textClasses.callout.fontFace` is kept in sans (Segoe UI Semibold) rather than forced monospace, per the skill's explicit guidance that KPI values should stay in a readable sans, not a full monospace family. **Escape hatch:** if a post-build screenshot review shows numeral misalignment in a specific table/KPI row, switch that visual's `value.fontFamily` (card) or column font to Consolas — a per-visual override, not a theme change.

## Artifacts

- `builder/pbi-theme/HouseEditorial-ca31b320.json` — the registered theme, adapted
  from `powerbi-report-design`'s `assets/base.json`, preserving its `tableEx`/
  `pivotTable`/`cardVisual`/`textbox` per-type safeguards (grow-to-fit columns, row
  banding, zero-padding cards, borderless textboxes).
- Validated clean via `powerbi-report-author validate` against a synthetic
  `.Report` wrapper (2026-07-04) — zero theme-registration errors. See Known
  gaps below for two properties that were dropped during validation.

## Known gaps (deliberately deferred, not silently dropped)

- **Filter pane / canvas-tint chrome** (`outspacePane`, `filterCard`, `outspace`)
  — `theming.md`'s own worked example shows these as `visualStyles["*"]["*"]`
  theme properties, but the installed CLI (v0.1.1, public preview) rejects them
  there with `PBIR_FORMATTING_OBJECT_UNKNOWN`. Dropped from the theme rather than
  shipping something the validator calls invalid. Revisit per-report at
  `page.json → objects` (the `page-formatting.md` / `filter-pane.md` mechanism)
  once Phase 1c is authoring real pages, or re-check after a CLI version bump.
- **cardVisual zero-padding / tightened label spacing** — `assets/base.json`
  itself ships a `cardVisual.padding`/`spacing` theme override, but the same CLI
  flags both (`PBIR_THEME_VISUAL_PROP_UNKNOWN`) even with a `$id: "default"`
  selector. Dropped from the theme; `border.show:false` and `title.show:false`
  (which *do* validate) are kept. Revisit as a per-visual VCO override at
  authoring time instead of a theme-wide default.
- **Hairline section-divider rules** (tone table: "Borders: none on visuals;
  section dividers only") — not expressible in `theme.json` at all; per
  `signatures.md` § S10 these are thin `textbox`/`shape` visuals placed between
  page sections. A per-page authoring convention for Phase 1c, not a theme
  concern.

## Registration (for whoever wires Phase 1c)

Per `powerbi-report-authoring`'s `theming.md`:

1. Copy `builder/pbi-theme/HouseEditorial-ca31b320.json` to
   `<Report>.Report/StaticResources/RegisteredResources/`.
2. In `<Report>.Report/definition/report.json`, set
   `themeCollection.customTheme = {"name": "HouseEditorial-ca31b320.json",
   "reportVersionAtImport": <copy from the existing baseTheme entry>, "type":
   "RegisteredResources"}` and add a matching `resourcePackages[]` entry
   (`name`/`path` = the same filename, `type: "CustomTheme"`).
3. **On every future edit to this theme file**, per the cache-busting
   convention: keep the name `HouseEditorial`, rotate only the GUID suffix,
   rename the file, and update both `report.json` references. Do not edit the
   file in place under the same name — Desktop caches themes by filename.
