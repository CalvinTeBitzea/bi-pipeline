"""
WHAT THIS FILE IS, IN BUSINESS TERMS
--------------------------------------
Automated tests for lib/layout.py, the "furniture placement" engine that
turns a coarse 12-column grid hint into exact pixel positions. Since this
logic runs on EVERY page of EVERY report this pipeline ever builds, bugs
here would silently affect everything downstream — these tests exist to
catch a layout regression immediately, rather than discovering it only when
a real report visibly looks broken.

Unit tests for the deterministic snap engine.

CONCEPT: "Unit" tests vs. "end-to-end" tests
-------------------------------------------------------------------------
This file tests ONE function (`snap_page`) in isolation, with plain
hand-written dictionaries as input — no real files, no AI, no other part of
the pipeline involved. That's what makes it a "unit" test: fast, focused,
and easy to pin down exactly what broke if it fails. Compare this to
test_pbip_builder.py, which is an "end-to-end" test — running many real
pipeline stages together against a real example file, closer to how the
whole system behaves for an actual user, but slower and less precise about
pinpointing WHERE a failure came from. Good test suites typically have both:
lots of fast unit tests for precision, plus a smaller number of end-to-end
tests for overall confidence.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from lib import layout  # noqa: E402


def _exec_overview_page() -> dict:
    # A representative hand-built page: two filter slicers, three KPI cards,
    # and three charts of varying size — deliberately covering every "band"
    # (row 0/1/2+) the layout engine treats specially, in one single example
    # reused across most of the tests below.
    return {
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


def _by_id(page: dict) -> dict:
    return {v["visual_id"]: v for v in page["visuals"]}


def test_every_visual_gets_layout_and_no_issues():
    page, issues = layout.snap_page(_exec_overview_page())
    assert issues == []
    for v in page["visuals"]:
        assert set(v["layout"]) == {"x", "y", "w", "h", "z", "tabOrder"}


def test_bands_stack_top_to_bottom():
    # Confirms the filter bar sits above the KPI band, which sits above the
    # charts — the fundamental visual hierarchy the whole layout system is
    # built around.
    page, _ = layout.snap_page(_exec_overview_page())
    v = _by_id(page)
    assert v["f1"]["layout"]["y"] < v["s1"]["layout"]["y"] < v["s5"]["layout"]["y"]


def test_trend_rowspan_is_taller_than_single_row_chart():
    # s5 spans 2 rows, s6 spans 1 — this checks that actually translates
    # into s5 being visibly taller in the final pixel layout.
    page, _ = layout.snap_page(_exec_overview_page())
    v = _by_id(page)
    assert v["s5"]["layout"]["h"] > v["s6"]["layout"]["h"]


def test_z_order_banded_by_type():
    page, _ = layout.snap_page(_exec_overview_page())
    v = _by_id(page)
    assert v["f1"]["layout"]["z"] < 1000          # slicer band
    assert 1000 <= v["s1"]["layout"]["z"] < 2000   # card band
    assert v["s5"]["layout"]["z"] >= 2000          # chart band


def test_all_within_canvas_bounds():
    # No visual should ever be placed even slightly off the edge of the
    # 1920x1080 canvas — this is the automated version of the `_check_bounds`
    # guard inside layout.py itself, verified here from the outside.
    page, _ = layout.snap_page(_exec_overview_page())
    for v in page["visuals"]:
        L = v["layout"]
        assert L["x"] >= -1 and L["y"] >= -1
        assert L["x"] + L["w"] <= layout.CANVAS_W + 1
        assert L["y"] + L["h"] <= layout.CANVAS_H + 1


def test_deterministic():
    # CONCEPT: Determinism — same input, same output, every single time
    # This is arguably the most important property of the entire builder
    # side of this pipeline (see pbip_builder.py's top-of-file note): unlike
    # an AI model, which can vary its output for the exact same prompt, this
    # code must produce IDENTICAL results given identical input, every time,
    # with no randomness anywhere. This test proves that directly by running
    # the same page through the engine twice and comparing results exactly.
    a, _ = layout.snap_page(_exec_overview_page())
    b, _ = layout.snap_page(_exec_overview_page())
    assert [v["layout"] for v in a["visuals"]] == [v["layout"] for v in b["visuals"]]


def test_overlap_detected():
    # Two visuals deliberately given the IDENTICAL grid position — proves
    # the overlap guard actually catches this obviously-invalid case rather
    # than silently stacking them on top of each other.
    page = {"visuals": [
        {"visual_id": "a", "type": "card", "grid": {"col": 0, "row": 1, "colSpan": 4, "rowSpan": 1}},
        {"visual_id": "b", "type": "card", "grid": {"col": 0, "row": 1, "colSpan": 4, "rowSpan": 1}},
    ]}
    _, issues = layout.snap_page(page)
    assert any("overlap" in i for i in issues)


def test_over_cap_flagged():
    # Generates one more visual than MAX_VISUALS allows, confirming the
    # "too many visuals for one page" guard actually fires — protecting
    # against a page so cluttered it would be unusable even if every
    # individual visual technically fit.
    n = layout.MAX_VISUALS + 1
    page = {"visuals": [
        {"visual_id": f"c{i}", "type": "card",
         "grid": {"col": (i % 4) * 3, "row": 1 + i // 4, "colSpan": 3, "rowSpan": 1}}
        for i in range(n)
    ]}
    _, issues = layout.snap_page(page)
    assert any(f"max {layout.MAX_VISUALS}" in i for i in issues)


def test_grid_synthesis_fallback_no_overlap():
    # None of these visuals specify a `grid` at all — this confirms the
    # fallback path (_ensure_grids in layout.py) successfully invents a
    # reasonable, non-overlapping placement purely from each visual's TYPE,
    # for the case where the AI's spec omitted layout entirely.
    page = {"visuals": [
        {"visual_id": "sl", "type": "slicer"},
        {"visual_id": "k1", "type": "card"},
        {"visual_id": "k2", "type": "card"},
        {"visual_id": "ch1", "type": "bar"},
        {"visual_id": "ch2", "type": "line"},
    ]}
    _, issues = layout.snap_page(page)
    assert not any("overlap" in i for i in issues)
    for v in page["visuals"]:
        assert "layout" in v and "grid" in v
