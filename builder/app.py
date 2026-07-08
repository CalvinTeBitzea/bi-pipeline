"""
WHAT THIS FILE IS, IN BUSINESS TERMS
--------------------------------------
This is the actual web server (nicknamed "bi-cohost" elsewhere in this
project) that the chat app in `agent/` talks to over the public internet
whenever it needs REAL, deterministic work done — not AI judgment, but exact
file validation and generation. It's the other end of two specific wires:

  1. bi-authoring's `validate_ir` custom tool (see
     agent/app/api/chat/route.js's `runValidateIr`) calls THIS file's
     `/api/validate` endpoint to get a real pass/fail verdict on the AI's
     design output — using the exact same gates the real build uses, not a
     separate, potentially-inconsistent re-implementation.
  2. The "Build PBIP" button in the chat UI (see
     agent/components/ChatInterface.jsx's `buildPbip`) calls THIS file's
     `/api/build` endpoint to actually produce the downloadable .zip of real
     Power BI files.

Both endpoints are thin HTTP wrappers around the SAME underlying pipeline
logic used by the command-line `conductor.py` (see agents/conductor.py) —
this file doesn't reimplement anything, it just exposes that existing logic
over the web so a browser-based chat app (which can't run a local Python CLI
itself) can trigger it remotely.

CONCEPT: Flask — a minimal web framework for Python
-------------------------------------------------------------------------
Flask is the Python equivalent of what Next.js's API routes are for
JavaScript (see agent/app/api/*/route.js): a way to turn a plain function
into a real HTTP endpoint. `@app.route("/api/build", methods=["POST"])`
declares "when a POST request arrives at this URL, run this function" — the
same underlying idea as Next.js's file-based routing, just spelled
differently in a different language/framework.

CONCEPT: CORS — why a server has to explicitly allow being called from a browser
---------------------------------------------------------------------------------
This service and the chat app in `agent/` are two SEPARATE deployments (this
one's nickname is "bi-cohost," commonly deployed to Vercel), likely on
different domains. Browsers block a web page from calling a different
domain's API by default, as a security measure (stopping a malicious site
from silently calling your bank's API using your logged-in session, for
instance) — unless that other domain explicitly opts in via special
response headers. The `_cors` helper and the `OPTIONS` "preflight" routes
below exist purely to say "yes, it's fine for a browser page on a different
domain to call this endpoint" — without them, every request from the chat
app would be silently blocked by the browser itself, never even reaching
this code.
"""
import io
import json
import os
import shutil
import sys
import uuid
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
os.environ.setdefault("ARTIFACT_ROOT", "/tmp/bi-cohost-builds")

from flask import Flask, jsonify, request, send_file

import agents.ingest as ingest_agent
import agents.pbip_builder as pbip_agent
from lib.artifact_store import artifact_path
from lib.tmdl_measures import MEASURES_TABLE_NAME, MODEL_REF_LINE, build_measures_table_tmdl, measure_blocks_by_table

app = Flask(__name__)


def _cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.route("/api/build", methods=["OPTIONS"])
def build_preflight():
    # The browser sends this "preflight" OPTIONS request automatically,
    # BEFORE the real POST, purely to ask "am I allowed to do this?" — this
    # handler's only job is to answer "yes" via the CORS headers above.
    return _cors(app.response_class("", 200))


@app.route("/api/build", methods=["POST"])
def build():
    """The real "turn this design into a downloadable Power BI project"
    endpoint — runs the full ingest + PBIR-build pipeline (the same two
    stages conductor.py's CLI runs), then packages the result as a .zip a
    browser can download directly, rather than leaving files sitting on
    this server's own disk (which, on this file's temporary-artifact-folder
    approach, gets deleted again immediately after — see the `shutil.rmtree`
    call below)."""
    try:
        body     = request.get_json(force=True)
        spec     = body["dashboard_spec"]
        model    = body["semantic_model"]
        build_id = body.get("build_id") or uuid.uuid4().hex[:8]

        ingest_agent.run(build_id, spec, model)
        result = pbip_agent.run(build_id)

        pages_dir = artifact_path(build_id, "report.pbir") / "definition" / "pages"

        # CONCEPT: Building a .zip file entirely in memory
        # `io.BytesIO()` is an in-memory "file" — the zip is assembled
        # without ever needing to write an intermediate .zip file to disk,
        # then handed straight to the browser as a download. Two kinds of
        # content go in: the generated PBIR page/visual files (which a user
        # drops directly into their existing .Report/definition/pages/
        # folder), and any TMDL fragments a skill produced (which need to be
        # copied manually into the SemanticModel project — this pipeline
        # writes the report pages but doesn't touch the semantic model
        # project files directly).
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            # pages/ content → extract into .Report/definition/pages/
            for f in sorted(pages_dir.rglob("*")):
                if f.is_file():
                    zf.write(f, f.relative_to(pages_dir))
            # tmdl/ content → copy each file to .SemanticModel/definition/tables/
            tmdl_fragments = result.get("tmdl_fragments", [])
            for fname, tmdl_text in tmdl_fragments:
                zf.writestr(f"tmdl/{fname}", tmdl_text)

            # A README travels WITH the zip itself, rather than relying on a
            # chat message or a server log line the user may never see — the
            # zip is the one artifact guaranteed to actually reach them, so
            # this is the most reliable place to explain the two manual
            # steps this pipeline can't safely do for the user (see
            # lib/tmdl_measures.py for why every measure goes into ONE new
            # `_Measures` table rather than being merged into existing data
            # tables: this pipeline never edits the user's existing
            # SemanticModel tables directly, since they already have real
            # data connections — a brand new, dedicated table is the one
            # thing that's always safe to just add).
            if tmdl_fragments:
                readme_lines = [
                    "This report's pages/visuals are ready to use as-is — copy",
                    "everything under pages/ into <YourReport>.Report/definition/pages/.",
                    "",
                    f"IMPORTANT — two manual steps remain to make this report's measures",
                    f"(KPIs like \"Net Revenue\", \"High-Severity Rate\", etc.) actually work —",
                    f"they're referenced by every visual that needs them, but a report's",
                    f"pages can't define the measures themselves; those live in the",
                    f"SemanticModel project instead:",
                    "",
                    f"1. Create a NEW file at",
                    f"     <YourReport>.SemanticModel/definition/tables/{MEASURES_TABLE_NAME}.tmdl",
                    f"   with the exact contents of tmdl/{MEASURES_TABLE_NAME}.tmdl from this zip.",
                    f"   (This is a brand new, dedicated table for measures only — the standard",
                    f"   Power BI convention — so it's always safe to add, never touches your",
                    f"   real data tables.)",
                    "",
                    f"2. Open <YourReport>.SemanticModel/definition/model.tmdl and add this",
                    f"   one line immediately before the existing `ref cultureInfo ...` line:",
                    f"     {MODEL_REF_LINE}",
                    f"   (Without this, Power BI Desktop won't know the new table exists.)",
                    "",
                    "Until you do both, the visuals will show as blank/errored in Desktop —",
                    "the report structure is correct, it's just missing the measure",
                    "definitions those visuals point to.",
                ]
                zf.writestr("README.txt", "\n".join(readme_lines))
        zip_bytes = buf.getvalue()

        # Clean up the temporary build artifacts on this server now that
        # they're safely packaged into the zip response — this server isn't
        # meant to be a permanent store of anyone's build output, only a
        # transient work area for the duration of one request.
        shutil.rmtree(pages_dir.parent.parent.parent, ignore_errors=True)

        response = send_file(
            io.BytesIO(zip_bytes),
            mimetype="application/zip",
            as_attachment=True,
            download_name=f"pages_{build_id}.zip",
        )
        return _cors(response)

    except Exception as exc:
        response = jsonify({"error": str(exc)})
        response.status_code = 500
        return _cors(response)


@app.route("/api/build-manifest", methods=["OPTIONS"])
def build_manifest_preflight():
    return _cors(app.response_class("", 200))


@app.route("/api/build-manifest", methods=["POST"])
def build_manifest():
    """The direct-write counterpart to /api/build.

    Same underlying ingest+build pipeline, same real files — but returned as
    a JSON manifest {pages, measuresTable, modelRefLine} instead of a zip,
    so the browser can write them straight into a user-connected local
    folder via the File System Access API (see agent/lib/localWrite.js)
    rather than making the user download-and-manually-copy.

    `measuresTable` carries BOTH shapes the client might need, since which
    one applies depends on whether `_Measures.tmdl` already exists locally
    (from an earlier build) or not — a decision only the client can make,
    since only it can see the user's actual folder:
      - `createContent`: the full, ready-to-write file, used the FIRST time
        (the table doesn't exist yet).
      - `measures`: the same measures individually rendered (name + block),
        used on a REBUILD to merge into the existing file one measure at a
        time, skipping any whose name is already there rather than
        duplicating it.
    `modelRefLine` is the one line the client needs to ensure exists in
    model.tmdl for Desktop to actually load the new table — see
    lib/tmdl_measures.py's MODEL_REF_LINE for exactly why.

    This is a genuinely separate, weaker guarantee than /api/build's zip:
    it hands the browser individual file CONTENTS and trusts it to write
    them to the right place inside a folder the user explicitly granted
    access to — it never touches anything on this server's or the user's
    disk outside of that request/response.
    """
    try:
        body     = request.get_json(force=True)
        spec     = body["dashboard_spec"]
        model    = body["semantic_model"]
        build_id = body.get("build_id") or uuid.uuid4().hex[:8]

        ingest_agent.run(build_id, spec, model)
        result = pbip_agent.run(build_id)

        pages_dir = artifact_path(build_id, "report.pbir") / "definition" / "pages"

        pages = []
        for f in sorted(pages_dir.rglob("*")):
            if f.is_file():
                rel = f.relative_to(pages_dir)
                pages.append({
                    "path": f"definition/pages/{rel.as_posix()}",
                    "content": f.read_text(),
                })

        shutil.rmtree(pages_dir.parent.parent.parent, ignore_errors=True)

        measures = model.get("measures", [])
        measures_table = {
            "name": MEASURES_TABLE_NAME,
            "createContent": build_measures_table_tmdl(measures) if measures else None,
            "measures": measure_blocks_by_table(measures).get(MEASURES_TABLE_NAME, []),
        }

        return _cors(jsonify({
            "pages": pages,
            "measuresTable": measures_table,
            "modelRefLine": MODEL_REF_LINE,
            "gate1": result["gate1"],
            "gate3": result["gate3"],
        }))
    except Exception as exc:
        response = jsonify({"error": str(exc)})
        response.status_code = 500
        return _cors(response)


@app.route("/api/validate", methods=["OPTIONS"])
def validate_preflight():
    return _cors(app.response_class("", 200))


@app.route("/api/validate", methods=["POST"])
def validate():
    """
    Validate dashboard_spec.json + semantic_model.json against the real build
    gates without producing a PBIP — the bi-authoring subagent's tool. Runs the
    same ingest + Gate 1 + Gate 3 checks as /api/build, returns JSON instead of
    a zip, and always cleans up its artifact directory. Gate 1b (the official
    CLI validator) is out of scope here — it needs a Desktop-scaffolded
    .Report folder and the CLI installed alongside this Vercel runtime, which
    remains unproven (see builder/PICKUP.md).

    This is the single most business-critical endpoint in the whole builder:
    it's what lets an AI agent (bi-authoring) get an OBJECTIVE, ground-truth
    answer to "is this design actually correct?" instead of just trusting
    its own (or another model's) self-assessment — see agent/agent-configs/
    bi-authoring.agent.yaml's job description, which explicitly requires
    calling this before ever telling the coordinator a design is ready.
    """
    build_id = "validate_" + uuid.uuid4().hex[:8]
    try:
        body  = request.get_json(force=True)
        spec  = body["dashboard_spec"]
        model = body["semantic_model"]

        ingest_result = ingest_agent.run(build_id, spec, model)
        result = pbip_agent.run(build_id)

        return _cors(jsonify({
            "valid": (
                result["gate1"]["passed"]
                and result["gate3"]["passed"]
                and not ingest_result["issues"]
            ),
            "ingest_issues": ingest_result["issues"],
            "gate1": result["gate1"],
            "gate3": result["gate3"],
        }))
    except Exception as exc:
        # Tool-result shape, not an HTTP error — the calling agent reads
        # `valid`/`error` from the body regardless of status code.
        return _cors(jsonify({"valid": False, "error": str(exc)}))
    finally:
        shutil.rmtree(artifact_path(build_id, ""), ignore_errors=True)
