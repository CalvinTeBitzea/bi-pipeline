"""
WHAT THIS FILE IS, IN BUSINESS TERMS
--------------------------------------
This is the command-line "assembly line manager" for turning an AI-authored
report design into a real, openable Power BI project. Despite living in a
folder called `agents/`, nothing in this file is an AI model — it's ordinary,
fully deterministic Python. That's a deliberate split in this whole system:
the CREATIVE decisions (what charts to use, what the DAX measures should say)
come from the AI pipeline in `agent/`; the MECHANICAL, must-be-exactly-right
work of writing valid Power BI project files is done here, by regular code
that behaves identically every time given the same input. You don't want an
AI "freestyling" a file format where a single wrong character can make Power
BI Desktop refuse to open the file — that's exactly the kind of task
traditional code is more trustworthy at than a language model.

Conductor — builder half of the BI-Workflow pipeline.

The wireframing agent (BI-Workflow) produces the design: a human wireframe.html plus
two structured artifacts. This conductor takes those artifacts and builds the PBIP:

    wireframe spec (IR) + semantic model  ──ingest──▶  validate + snap geometry
                                          ──build───▶  PBIR pages + visuals (skills)

CONCEPT: A pipeline of STAGES, each one either running or skipped
-------------------------------------------------------------------------
This file doesn't do the real work itself — it calls, in order, two stages
that live in their own files (`ingest.py`, `pbip_builder.py`), the same way
a factory line manager doesn't personally assemble a product but does make
sure each station does its job in the right sequence. Each stage's outcome is
recorded (see lib/artifact_store.py's `mark_stage_done`), so re-running this
same build again (e.g. after fixing a typo) doesn't have to redo stages that
already succeeded — `_step` below checks that record and skips a stage
whose work is already done, unless `--force` says to redo everything anyway.
This "skip what's already done" idea is the same principle as an incremental
build system (like `make`), just applied to a two-stage pipeline instead of
compiling code.

CONCEPT: Command-line interfaces (CLI) via the `click` library
-------------------------------------------------------------------------
`click` is a Python library for turning a plain function into a real
command-line program — the `@click.command()` / `@click.option(...)`
decorators below are what let someone run this file from a terminal with
named flags (`--wireframe-spec path/to/file.json`), get automatic `--help`
text, and have Click validate that a given file path actually exists before
the function even runs (`type=click.Path(exists=True)`).

Usage:
  python agents/conductor.py \\
    --wireframe-spec  path/to/dashboard_spec.json \\
    --semantic-model  path/to/semantic_model.json \\
    --build-id my-build-001 \\
    [--pbip-path /path/to/MyReport.Report]   # existing PBIP .Report folder
    [--force]
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import click

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

import agents.ingest as ingest_agent
import agents.pbip_builder as pbip_agent
from lib.artifact_store import is_stage_done


def _step(label: str, build_id: str, stage: str, force: bool, fn):
    """Run one pipeline stage, printing progress — unless it's already been
    completed for this build_id (and `--force` wasn't passed), in which case
    skip it entirely and say so. This is the "incremental build" behavior
    described above, in one small reusable helper."""
    if not force and is_stage_done(build_id, stage):
        print(f"  ✓ {label} (cached)")
        return
    print(f"  → {label}...")
    t0 = time.time()
    fn()
    print(f"  ✓ {label} ({time.time() - t0:.1f}s)")


@click.command()
@click.option("--wireframe-spec", required=True, type=click.Path(exists=True),
              help="dashboard_spec.json (IR) co-emitted by the wireframing agent")
@click.option("--semantic-model", required=True, type=click.Path(exists=True),
              help="semantic_model.json co-emitted by the wireframing agent")
@click.option("--build-id", required=True, help="Unique identifier for this build")
@click.option("--pbip-path", default=None, type=click.Path(),
              help="Path to an existing .Report folder; pages are added into it")
@click.option("--force", is_flag=True, default=False, help="Re-run all stages")
def main(wireframe_spec, semantic_model, build_id, pbip_path, force):
    """bi-cohost builder: wireframe spec + semantic model → .pbip"""
    print(f"\nbi-cohost build: {build_id}")
    print("=" * 50)

    # Stage 1: check the two AI-authored files are well-formed and internally
    # consistent (see ingest.py for exactly what that means).
    _step("Stage 1: Ingest", build_id, "ingest", force,
          lambda: ingest_agent.run(build_id, wireframe_spec, semantic_model))

    result = {}

    def _build():
        nonlocal result
        result = pbip_agent.run(build_id, pbip_report_path=pbip_path)

    # Stage 2: the actual file-writing step — turns the validated spec into
    # real PBIR pages/visuals (see pbip_builder.py, the largest and most
    # detailed file in this whole builder).
    _step("Stage 2: PBIP Builder", build_id, "pbip_builder", force, _build)

    print("=" * 50)
    if result:
        # "Gates" are pass/fail quality checks baked into the pipeline itself
        # — not just tests run separately by a developer, but checks the
        # BUILD ITSELF performs and reports on every run, the same way a
        # factory might have an automated inspection step before a product
        # ships, not just spot-checks during development.
        g1 = "PASS" if result.get("gate1", {}).get("passed") else "FAIL"
        g3 = "PASS" if result.get("gate3", {}).get("passed") else "FAIL"
        print(f"  Gate 1 (JSON valid): {g1}")
        print(f"  Gate 3 (IR fidelity): {g3}")
        print(f"  Output: {pbip_path or result.get('output_dir', '')}")
    if pbip_path:
        print("\n  Reopen the .pbip in Power BI Desktop to see the new pages.")


if __name__ == "__main__":
    main()
