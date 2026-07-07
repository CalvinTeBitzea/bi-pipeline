"""
WHAT THIS FILE IS, IN BUSINESS TERMS
--------------------------------------
NOTE ON THIS FILE'S STATUS: nothing else in this codebase currently imports
or calls this module — it isn't wired into the live pipeline. It appears to
be an earlier prototype of "write a whole .pbip project from scratch,"
producing a SIMPLER, non-PBIR project layout (one big report.json, one
model.tmdl) than the format the live pipeline actually targets today. That
live approach — adding PBIR pages/visuals into an EXISTING project Power BI
Desktop already scaffolded — lives in agents/pbip_builder.py instead, and is
a meaningfully different strategy (this file builds a project from nothing;
pbip_builder.py only ever adds pages into a project Desktop already created
and still partly owns). Kept here as a reference/historical artifact rather
than deleted, but a reader following the REAL, currently-running pipeline
should treat agents/pbip_builder.py as the authoritative implementation.

Writes the .pbip project folder structure that Power BI Desktop can open.

Output layout (matching the PBIP 1.0 format):

    artifacts/{build_id}/
      report.pbip/                    ← the project folder
        {build_id}.pbip               ← manifest JSON (open THIS in PBI Desktop)
        model/
          model.tmdl                  ← semantic model (TMDL)
        report/
          report.json                 ← report structure + embedded sections
          pages/
            {page_name}.json          ← one file per page
"""

import json
from pathlib import Path


_PBIP_MANIFEST = {
    "version": "1.0",
    "artifacts": [
        {"report": {"path": "report"}}
    ],
    "settings": {
        "enableAutoRecovery": True
    }
}


def write_pbip(
    build_id: str,
    build_dir: Path,
    tmdl: str,
    report_json: dict,
    pages: list[dict],
) -> Path:
    """
    Write all .pbip files to disk. Returns the path to the project folder
    (report.pbip/). User should open {build_id}.pbip inside that folder
    in Power BI Desktop.
    """
    pbip_dir = build_dir / "report.pbip"

    (pbip_dir / "model").mkdir(parents=True, exist_ok=True)
    (pbip_dir / "report" / "pages").mkdir(parents=True, exist_ok=True)

    # Manifest — the file you open in PBI Desktop
    (pbip_dir / f"{build_id}.pbip").write_text(
        json.dumps(_PBIP_MANIFEST, indent=2)
    )

    # Semantic model
    (pbip_dir / "model" / "model.tmdl").write_text(tmdl)

    # Individual page files
    for page in pages:
        slug = page.get("name", "page")
        (pbip_dir / "report" / "pages" / f"{slug}.json").write_text(
            json.dumps(page, indent=2)
        )

    # report.json — sections embedded (PBI reads both)
    (pbip_dir / "report" / "report.json").write_text(
        json.dumps(report_json, indent=2)
    )

    return pbip_dir
