"""
WHAT THIS FILE IS, IN BUSINESS TERMS
--------------------------------------
This is the "furniture placement" engine — it turns the AI's simple,
approximate description of where a chart should go ("row 2, spanning 8 of
12 columns") into the EXACT pixel coordinates Power BI's file format
actually requires. It's the same translation a floor planner does turning
"a 3-seat sofa against the north wall" into precise x/y/width/height
measurements a construction crew can build from.

Deterministic snap engine.

Turns each visual's coarse `grid` hint ({col,row,colSpan,rowSpan} on a 12-column
canvas) into a resolved pixel `layout` ({x,y,w,h,z}) on the FHD (1920x1080) PBIR
canvas. This is the single layout authority shared by the HTML wireframe and the
PBIR builder, so the two never drift.

CONCEPT: A 12-column grid system — why the AI never has to think in pixels
-------------------------------------------------------------------------
Asking an AI model to directly produce exact pixel coordinates for a dozen
charts on a page is asking for trouble — small arithmetic slips compound
into overlapping or off-canvas visuals. A "12-column grid" (the same idea
professional web/print design tools use) lets the model instead reason in
much coarser, much harder-to-get-wrong terms: "this chart takes half the
row" (colSpan 6 of 12) rather than "this chart is exactly 906 pixels wide
starting at x=942." This file is the ONE place that does the actual pixel
math, deterministically, so it's always exactly consistent — never subject
to an AI's arithmetic mistakes.

`grid.row` selects a horizontal **band** the engine owns vertically:
  row 0 → filter bar (slicers, thin)   row 1 → KPI band (cards)
  row >=2 → chart rows (share remaining height); rowSpan spans consecutive rows.

Visuals with no `grid` get one synthesised by type (slicers → filter bar,
cards → KPI band, everything else → chart grid) so there is one code path.
"""
from __future__ import annotations

# Canvas + spacing constants (PBIR units). FHD (1920x1080) is the house default
# per contracts/HOUSE_DESIGN_BRIEF.md; spacing constants are scaled 1.5x from
# the prior 1280x720 canvas (same 16:9 ratio) to preserve identical proportions.
CANVAS_W, CANVAS_H = 1920, 1080
MARGIN = 36      # left/right outer margin
GUTTER = 18      # horizontal gap between grid columns
VGAP = 18        # vertical gap between bands
TOP = 24         # top margin
BOTTOM = 15      # bottom margin
COLS = 12

FILTER_BAND_H = 72    # row 0
KPI_BAND_H = 180      # row 1
MAX_VISUALS = 20     # realistic per-page budget (wireframe is authoritative)

_Z_BASE = {"slicer": 500, "card": 1000}
_Z_DEFAULT = 2000


def snap_page(page: dict) -> tuple[dict, list[str]]:
    """Resolve `layout` for every visual in `page`. Mutates and returns the page
    plus a list of issue strings (overlaps, out-of-bounds, >8 visuals).

    Overall recipe: figure out which vertical "bands" (row 0 = filters, row 1
    = KPIs, row 2+ = charts) are actually used on this page, compute how tall
    each one should be, then place every visual left-to-right/top-to-bottom
    within its band based on its col/colSpan. Finally, run guard checks
    (`_check_bounds`/`_check_overlap`) to catch a spec that's internally
    inconsistent (e.g. too many visuals crammed into one row) BEFORE it
    becomes a visually broken report.
    """
    visuals = page.get("visuals", [])
    _ensure_grids(visuals)

    # Which bands are occupied (including rows covered by rowSpan)?
    bands: set[int] = set()
    for v in visuals:
        g = v["grid"]
        for r in range(g["row"], g["row"] + g.get("rowSpan", 1)):
            bands.add(r)
    bands_sorted = sorted(bands)

    band_h = _band_heights(bands_sorted)
    band_y = _band_offsets(bands_sorted, band_h)

    col_w = (CANVAS_W - 2 * MARGIN - (COLS - 1) * GUTTER) / COLS

    for v in visuals:
        g = v["grid"]
        col, cs = g["col"], g.get("colSpan", 1)
        row, rs = g["row"], g.get("rowSpan", 1)
        x = MARGIN + col * (col_w + GUTTER)
        w = cs * col_w + (cs - 1) * GUTTER
        y = band_y[row]
        h = sum(band_h[row + i] for i in range(rs)) + VGAP * (rs - 1)
        v["layout"] = {"x": round(x, 2), "y": round(y, 2),
                       "w": round(w, 2), "h": round(h, 2), "z": 0}

    _assign_z_and_taborder(visuals)

    issues = _check_bounds(visuals) + _check_overlap(visuals)
    if len(visuals) > MAX_VISUALS:
        issues.append(f"page has {len(visuals)} visuals (max {MAX_VISUALS})")
    return page, issues


# ── band sizing ────────────────────────────────────────────────────────────────
# The filter bar and KPI band have FIXED heights (a slicer or KPI card
# doesn't need to grow); every remaining "chart band" splits the leftover
# vertical space evenly between however many chart rows actually exist on
# the page — the same idea as a picture frame with two fixed-size mats and
# the remaining space split evenly between however many photos you're
# framing.

def _band_heights(bands: list[int]) -> dict[int, float]:
    fixed = {}
    for b in bands:
        if b == 0:
            fixed[b] = FILTER_BAND_H
        elif b == 1:
            fixed[b] = KPI_BAND_H
    chart_bands = [b for b in bands if b not in fixed]
    avail = CANVAS_H - TOP - BOTTOM - sum(fixed.values()) - VGAP * max(len(bands) - 1, 0)
    chart_h = (avail / len(chart_bands)) if chart_bands else 0
    return {b: fixed.get(b, chart_h) for b in bands}


def _band_offsets(bands: list[int], band_h: dict[int, float]) -> dict[int, float]:
    offsets, y = {}, float(TOP)
    for b in bands:
        offsets[b] = y
        y += band_h[b] + VGAP
    return offsets


# ── grid synthesis (fallback when a visual has no grid) ─────────────────────────
# If the AI's spec somehow omits grid placement for a visual (shouldn't
# normally happen, but this keeps the pipeline resilient rather than
# crashing), this gives it a REASONABLE default position based purely on its
# TYPE — slicers go in the filter bar, cards in the KPI band, everything
# else spreads two-per-row starting below those — rather than leaving it
# unplaced.

def _ensure_grids(visuals: list[dict]) -> None:
    if all("grid" in v for v in visuals):
        return
    slicers = [v for v in visuals if v.get("type") == "slicer" and "grid" not in v]
    cards = [v for v in visuals if v.get("type") == "card" and "grid" not in v]
    charts = [v for v in visuals
              if v.get("type") not in ("slicer", "card") and "grid" not in v]

    def spread(group: list[dict], row: int) -> None:
        n = len(group)
        if not n:
            return
        span = max(1, COLS // n)
        for i, v in enumerate(group):
            v["grid"] = {"col": min(i * span, COLS - span), "row": row,
                         "colSpan": span, "rowSpan": 1}

    spread(slicers, 0)
    spread(cards, 1)
    # charts: two per row starting at band 2
    for i, v in enumerate(charts):
        col = 0 if i % 2 == 0 else 6
        v["grid"] = {"col": col, "row": 2 + i // 2, "colSpan": 6, "rowSpan": 1}


# ── z-order + tab order ─────────────────────────────────────────────────────────
# "z-order" is which visual draws ON TOP when two overlap (higher number =
# in front) — filters/slicers are kept behind cards, which are kept behind
# charts, by convention, matching how the house design brief expects layers
# to stack. "Tab order" is the sequence keyboard/screen-reader navigation
# visits visuals in — assigned here top-to-bottom, left-to-right, which is
# the natural reading order a sighted user would also scan the page in
# (an accessibility consideration, not just a cosmetic one).

def _assign_z_and_taborder(visuals: list[dict]) -> None:
    order = sorted(visuals, key=lambda v: (v["layout"]["y"], v["layout"]["x"]))
    for i, v in enumerate(order):
        v["layout"]["z"] = _Z_BASE.get(v.get("type"), _Z_DEFAULT) + i
        v["layout"]["tabOrder"] = i


# ── guards ──────────────────────────────────────────────────────────────────────
# Sanity checks run AFTER placement: did anything end up off the edge of the
# canvas, or on top of another visual? These don't PREVENT a build — they
# surface as warnings the authoring/QA stage of the AI pipeline can act on —
# but they're what catches "the spec asked for something that doesn't
# actually fit" before a human ever opens the file and sees it visually.

def _check_bounds(visuals: list[dict], eps: float = 1.0) -> list[str]:
    issues = []
    for v in visuals:
        L = v["layout"]
        if L["x"] < -eps or L["y"] < -eps or \
           L["x"] + L["w"] > CANVAS_W + eps or L["y"] + L["h"] > CANVAS_H + eps:
            issues.append(f"{v.get('visual_id', '?')} out of bounds: {L}")
    return issues


def _check_overlap(visuals: list[dict], eps: float = 1.0) -> list[str]:
    issues = []
    for i in range(len(visuals)):
        for j in range(i + 1, len(visuals)):
            a, b = visuals[i]["layout"], visuals[j]["layout"]
            if (a["x"] < b["x"] + b["w"] - eps and a["x"] + a["w"] > b["x"] + eps and
                    a["y"] < b["y"] + b["h"] - eps and a["y"] + a["h"] > b["y"] + eps):
                issues.append(f"overlap: {visuals[i].get('visual_id','?')} & "
                              f"{visuals[j].get('visual_id','?')}")
    return issues


if __name__ == "__main__":
    # CONCEPT: a self-test you can run directly (`python layout.py`)
    # Rather than needing the whole pipeline running, this block lets a
    # developer sanity-check the layout engine in isolation against one
    # hand-written example page — quick manual verification during
    # development, separate from the formal automated tests in
    # builder/tests/test_layout.py.
    # smoke: the worked-example page (8 visuals)
    import json
    page = {
        "page_id": "p1", "name": "Overview", "type": "overview",
        "visuals": [
            {"visual_id": "f1", "type": "slicer", "grid": {"col": 0, "row": 0, "colSpan": 4, "rowSpan": 1}},
            {"visual_id": "f2", "type": "slicer", "grid": {"col": 4, "row": 0, "colSpan": 4, "rowSpan": 1}},
            {"visual_id": "s1", "type": "card", "grid": {"col": 0, "row": 1, "colSpan": 3, "rowSpan": 1}},
            {"visual_id": "s2", "type": "card", "grid": {"col": 3, "row": 1, "colSpan": 3, "rowSpan": 1}},
            {"visual_id": "s3", "type": "card", "grid": {"col": 6, "row": 1, "colSpan": 3, "rowSpan": 1}},
            {"visual_id": "s5", "type": "line", "grid": {"col": 0, "row": 2, "colSpan": 8, "rowSpan": 2}},
            {"visual_id": "s6", "type": "bar", "grid": {"col": 8, "row": 2, "colSpan": 4, "rowSpan": 1}},
            {"visual_id": "s7", "type": "table", "grid": {"col": 8, "row": 3, "colSpan": 4, "rowSpan": 1}},
        ],
    }
    _, issues = snap_page(page)
    print(json.dumps([{v["visual_id"]: v["layout"]} for v in page["visuals"]], indent=2))
    print("issues:", issues or "none")
