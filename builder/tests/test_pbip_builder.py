"""
WHAT THIS FILE IS, IN BUSINESS TERMS
--------------------------------------
The most important confidence check in the whole builder: does the ENTIRE
pipeline — ingest, layout, skill-filling, gates — actually work correctly
end to end, against a real, representative report? Every other test file
checks one small piece in isolation; this one strings the real pieces
together, the closest thing to "does this actually work the way a real user
would experience it" without needing a live AI conversation or an actual
copy of Power BI Desktop.

End-to-end: retail golden example → ingest → PBIR builder.

Drives the real retail wireframe spec + semantic model (hand-encoded from the
BI-Workflow agent's wireframe.html + requirements.md) through ingest and the builder,
with no Power BI Desktop and no API key. Proves the realigned bridge:
agent artifacts → IR (snapped) → PBIR, gates passing, skill visual emitted.

CONCEPT: A "golden example" — one trusted, realistic reference case
-------------------------------------------------------------------------
Rather than inventing a new toy example for each test, this whole file reuses
ONE hand-verified, realistic report definition (`examples/retail/`) as its
input across every test. This has two benefits: it's a genuinely
representative test (real page structure, real chart types, real DAX
measures — not an oversimplified toy case that might miss real bugs), and
whenever this example changes, every test using it is automatically
re-checked against the update.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest  # noqa: E402
import lib.artifact_store as store  # noqa: E402
import agents.ingest as ingest  # noqa: E402
import agents.pbip_builder as pbip  # noqa: E402

EXAMPLE = Path(__file__).parent.parent / "examples" / "retail"


@pytest.fixture()
def build(tmp_path, monkeypatch):
    # Redirect both the artifact store AND pbip_builder's own artifact_path
    # lookups into a fresh scratch folder, then actually RUN the real ingest
    # stage against the real retail example — every test in this file that
    # asks for `build` starts from this same, already-ingested state.
    monkeypatch.setattr(store, "_BASE", tmp_path)
    monkeypatch.setattr(pbip, "artifact_path", lambda bid, fn: tmp_path / bid / fn)
    ingest.run("r1", str(EXAMPLE / "dashboard_spec.json"),
               str(EXAMPLE / "semantic_model.json"))
    return tmp_path


@pytest.fixture()
def full_report_path(tmp_path):
    """A minimal Desktop-scaffolded .Report skeleton (report.json/version.json/
    pages.json) — lets pbip_builder register the house theme and lets Gate 1b
    (the official CLI validator) run against a real path, instead of the
    incomplete pages-only output written in scaffold mode.

    This hand-builds just enough of a fake "Power BI Desktop already created
    this project" folder structure to let tests exercise the code path that
    normally only runs against a REAL Desktop-created project — without
    needing an actual, licensed copy of Power BI Desktop running anywhere in
    this test environment.
    """
    report_dir = tmp_path / "Retail.Report"
    (report_dir / "definition" / "pages").mkdir(parents=True)
    (report_dir / "definition" / "version.json").write_text(json.dumps({"version": "2.0.0"}))
    (report_dir / "definition" / "report.json").write_text(json.dumps({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/"
                   "definition/report/3.3.0/schema.json",
        "themeCollection": {
            "baseTheme": {
                "name": "CY24SU10",
                "reportVersionAtImport": {"visual": "5.61.0", "report": "5.61.0", "page": "5.61.0"},
                "type": "SharedResources",
            }
        },
    }))
    (report_dir / "definition" / "pages" / "pages.json").write_text(json.dumps({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/"
                   "definition/pagesMetadata/1.0.0/schema.json",
        "pageOrder": [], "activePageName": "",
    }))
    return report_dir


def test_ingest_snaps_layout_and_validates(build):
    spec = store.read_artifact("r1", "dashboard_spec.json")
    for page in spec["pages"]:
        for v in page["visuals"]:
            assert set(v["layout"]) == {"x", "y", "w", "h", "z", "tabOrder"}


def test_build_gates_pass(build):
    # The headline assertion: for a genuinely valid, real-world report
    # definition, both automated gates must pass — if this test ever fails,
    # it means either the retail example broke, or (more concerning) the
    # builder itself regressed on a previously-working case.
    result = pbip.run("r1", pbip_report_path=None)
    assert result["gate1"]["passed"], result["gate1"]["errors"]
    assert result["gate3"]["passed"], result["gate3"]["issues"]


def test_two_pages_and_all_visuals_written(build):
    result = pbip.run("r1", pbip_report_path=None)
    pages_dir = Path(result["output_dir"])
    page_dirs = [d for d in pages_dir.iterdir() if d.is_dir()]
    assert len(page_dirs) == 2
    visual_files = list(pages_dir.rglob("visual.json"))
    assert len(visual_files) == 21  # 13 on p1 + 8 on p2


def test_pareto_uses_combo_skill(build):
    # Confirms the retail example's Pareto-style chart actually gets built
    # via the dedicated combo-chart "skill" template (see lib/skills.py),
    # not just the generic fallback builder — proving the skill-selection
    # mechanism actually engages for the visual type it's meant for.
    result = pbip.run("r1", pbip_report_path=None)
    types = {json.loads(f.read_text())["visual"]["visualType"]
             for f in Path(result["output_dir"]).rglob("visual.json")}
    assert "lineStackedColumnComboChart" in types   # Pareto via the skill
    assert "scatterChart" in types                   # scatter fallback
    assert "donutChart" in types                     # donut fallback
    assert "tableEx" in types                         # ranked table fallback


def test_combo_bound_to_pareto_fields(build):
    # Not just "the right chart TYPE was used" but "it's actually showing
    # the RIGHT DATA" — bars = revenue, line = cumulative %, category =
    # product name, matching what a real Pareto analysis needs.
    result = pbip.run("r1", pbip_report_path=None)
    combo = next(json.loads(f.read_text()) for f in Path(result["output_dir"]).rglob("visual.json")
                 if json.loads(f.read_text())["visual"]["visualType"] == "lineStackedColumnComboChart")
    qs = combo["visual"]["query"]["queryState"]
    # bars = Net Revenue, line = cumulative %, category = ProductName
    assert qs["Y"]["projections"][0]["nativeQueryRef"] == "Net Revenue"
    assert qs["Y2"]["projections"][0]["nativeQueryRef"] == "Cumulative Net Revenue %"
    assert qs["Category"]["projections"][0]["queryRef"] == "Dim_Product.ProductName"


def test_scatter_uses_x_y_size_roles_not_category_y_fallback(build):
    """Regression guard: the generic Category+Y fallback is invalid for
    scatterChart (missing required X, too many Y projections) — caught by
    powerbi-report-author validate. See _build_query_state's scatterChart branch.

    CONCEPT: A "regression test" — locking in a bug fix permanently
    -------------------------------------------------------------------------
    This test exists BECAUSE this exact mistake happened once for real
    (caught by Gate 1b's official CLI validator) and was then fixed. Writing
    a test that specifically checks for that exact scenario means if a
    future code change accidentally reintroduces the same mistake, it fails
    a test immediately — instead of silently shipping the same bug a second
    time. This is one of the most valuable moments to add a test: right
    after fixing a real bug, not just when writing new features.
    """
    result = pbip.run("r1", pbip_report_path=None)
    scatter = next(json.loads(f.read_text()) for f in Path(result["output_dir"]).rglob("visual.json")
                   if json.loads(f.read_text())["visual"]["visualType"] == "scatterChart")
    qs = scatter["visual"]["query"]["queryState"]
    assert "X" in qs and len(qs["X"]["projections"]) == 1
    assert "Y" in qs and len(qs["Y"]["projections"]) == 1
    assert "Size" in qs and len(qs["Size"]["projections"]) == 1
    assert "Category" in qs and len(qs["Category"]["projections"]) == 1


def test_gate1b_cli_validate_passes_when_installed(build, full_report_path):
    """Gate 1b (powerbi-report-author validate) skips gracefully if the CLI
    isn't installed, but must PASS when it is — regression guard so a future
    change can't silently reintroduce a schema-invalid visual (like the
    scatterChart bug this same gate caught).

    CONCEPT: A test that adapts to what's available in its environment
    -------------------------------------------------------------------------
    `pytest.skip(...)` marks this test as neither pass nor fail when a
    genuine PREREQUISITE (the separate, optional CLI tool) isn't installed
    in whatever machine happens to be running the test suite — an honest
    "couldn't check this here" rather than a false failure that would
    wrongly alarm anyone running tests without that CLI available.
    """
    result = pbip.run("r1", pbip_report_path=str(full_report_path))
    if result["gate1b"]["passed"] is None:
        pytest.skip("powerbi-report-author CLI not installed")
    assert result["gate1b"]["passed"], result["gate1b"]["messages"]
