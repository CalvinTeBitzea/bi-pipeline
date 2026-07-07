"""
WHAT THIS FILE IS, IN BUSINESS TERMS
--------------------------------------
This is the "receiving inspection" step of the builder pipeline — the first
thing that happens to the two files the AI pipeline produced
(dashboard_spec.json and semantic_model.json) before any real Power BI files
get written. Think of it like a warehouse checking a shipment against its
packing list before it's allowed onto the production floor: are both
documents shaped correctly, and does everything one document refers to
actually exist in the other? Nothing creative happens here — it's pure
verification and light data-completion (filling in exact pixel positions
from a simpler grid description).

Ingest — the entry point of the builder half.

The wireframing agent (BI-Workflow) co-emits two structured artifacts alongside its
human-facing wireframe.html:
  - a wireframe spec  → the dashboard_spec.json IR (pages/visuals/type/fields/grid/skill)
  - a semantic model  → semantic_model.json (measures+DAX, dimensions, relationships)

This stage validates both against the schemas, resolves pixel geometry from each
visual's `grid` (lib.layout.snap_page), and writes them into the build's artifacts so
`pbip_builder` can produce the PBIP. No design happens here — the wireframe is the
authoritative design.

CONCEPT: "IR" — an Intermediate Representation
-------------------------------------------------------------------------
dashboard_spec.json isn't the final Power BI file format, and it isn't just
free-form notes either — it's a structured, precisely-defined format
IN BETWEEN the AI's design decisions and the actual PBIR files Power BI
Desktop reads. Using an IR is what allows a strict separation of concerns:
the AI agents only ever need to learn ONE simple, stable schema (this IR),
while all of the much more complex, PBIR-format-specific logic lives
entirely in pbip_builder.py — if Power BI's file format changes someday,
only that one file needs to change, not every agent's prompt.
"""
from __future__ import annotations

import json
from pathlib import Path

from lib import layout
from lib.artifact_store import write_artifact, mark_stage_done
from lib.schema_validator import validate


def run(build_id: str, wireframe_spec: str | dict, semantic_model: str | dict) -> dict:
    spec = _load(wireframe_spec)
    model = _load(semantic_model)

    # Step 1: schema validation — does each file have the right fields, of
    # the right types, in the right shape? (see lib/schema_validator.py)
    validate("semantic_model", model)
    validate("dashboard_spec", spec)

    # Step 2: resolve geometry from grid for any visual missing layout; collect issues.
    # The AI describes visual placement using a simple "row/column span" grid
    # (see bi-design's job description for the exact convention) rather than
    # exact pixel coordinates — that's an easier, less error-prone thing for
    # a model to reason about. `snap_page` is what translates that simpler
    # grid description into the precise pixel geometry Power BI actually
    # needs, the same way a floor plan's "unit 3B" gets translated into
    # exact wall coordinates before construction.
    issues: list[str] = []
    for page in spec.get("pages", []):
        _, page_issues = layout.snap_page(page)
        issues.extend(f"{page.get('page_id')}: {i}" for i in page_issues)

    # Step 3: cross-reference check — confirm every measure/dimension a
    # visual claims to use is actually defined in the semantic model. This
    # is the same kind of check as verifying every citation in a report
    # actually points to a real source in the bibliography.
    issues.extend(_validate_refs(spec, model))

    validate("dashboard_spec", spec)  # re-validate after snap added layout

    # Persist the validated (and now geometry-complete) files as this build's
    # official record of "what ingest produced" — the next stage
    # (pbip_builder.py) reads these back rather than re-doing this work.
    write_artifact(build_id, "semantic_model.json", model)
    write_artifact(build_id, "dashboard_spec.json", spec)
    mark_stage_done(build_id, "ingest")

    n_visuals = sum(len(p.get("visuals", [])) for p in spec.get("pages", []))
    print(f"  [ingest] {len(spec.get('pages', []))} page(s), {n_visuals} visual(s)"
          + (f"; {len(issues)} issue(s)" if issues else ""))
    for i in issues:
        print(f"    {i}")
    return {"pages": len(spec.get("pages", [])), "visuals": n_visuals, "issues": issues}


def _validate_refs(spec: dict, model: dict) -> list[str]:
    """Every visual in dashboard_spec.json names measures/dimensions by
    STRING NAME (not a database-style foreign key) — this function is what
    actually enforces that those names are real, by comparing them against
    the full set of names actually defined in the semantic model."""
    measures = {m["name"] for m in model.get("measures", [])}
    dims = {d["name"] for d in model.get("dimensions", [])}
    bad = []
    for page in spec.get("pages", []):
        for v in page.get("visuals", []):
            for m in v.get("measures", []):
                if m not in measures:
                    bad.append(f"{v.get('visual_id')}: unknown measure '{m}'")
            for d in v.get("dimensions", []):
                if d not in dims:
                    bad.append(f"{v.get('visual_id')}: unknown dimension '{d}'")
    return bad


def _load(src: str | dict) -> dict:
    """Accepts either an already-parsed dict or a path to a JSON file on
    disk — lets `run()` be called the same way whether it's driven from the
    CLI (a file path) or, e.g., directly from a web API handler that already
    has the parsed JSON in memory (see builder/app.py)."""
    if isinstance(src, dict):
        return src
    return json.loads(Path(src).read_text())
