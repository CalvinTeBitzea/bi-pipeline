"""
Flask entry point for Vercel deployment — POST /api/build
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

app = Flask(__name__)


def _cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.route("/api/build", methods=["OPTIONS"])
def build_preflight():
    return _cors(app.response_class("", 200))


@app.route("/api/build", methods=["POST"])
def build():
    try:
        body     = request.get_json(force=True)
        spec     = body["dashboard_spec"]
        model    = body["semantic_model"]
        build_id = body.get("build_id") or uuid.uuid4().hex[:8]

        ingest_agent.run(build_id, spec, model)
        result = pbip_agent.run(build_id)

        pages_dir = artifact_path(build_id, "report.pbir") / "definition" / "pages"

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            # pages/ content → extract into .Report/definition/pages/
            for f in sorted(pages_dir.rglob("*")):
                if f.is_file():
                    zf.write(f, f.relative_to(pages_dir))
            # tmdl/ content → copy each file to .SemanticModel/definition/tables/
            for fname, tmdl_text in result.get("tmdl_fragments", []):
                zf.writestr(f"tmdl/{fname}", tmdl_text)
        zip_bytes = buf.getvalue()

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
