"""
POST /api/validate — the bi-authoring subagent's validate_ir tool endpoint.

Reuses the retail golden example: a valid case (should pass all gates) and a
deliberately broken case (an unknown measure reference, the kind of mistake a
design-generating agent could plausibly make) to prove the endpoint surfaces
real, actionable failures rather than always reporting success.
"""
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest  # noqa: E402
import lib.artifact_store as store  # noqa: E402
import app as flask_app  # noqa: E402

EXAMPLE = Path(__file__).parent.parent / "examples" / "retail"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "_BASE", tmp_path)
    flask_app.app.testing = True
    return flask_app.app.test_client()


def _retail_payload():
    spec = json.loads((EXAMPLE / "dashboard_spec.json").read_text())
    model = json.loads((EXAMPLE / "semantic_model.json").read_text())
    return spec, model


def test_valid_retail_example_passes(client):
    spec, model = _retail_payload()
    res = client.post("/api/validate", json={
        "dashboard_spec": spec, "semantic_model": model,
    })
    body = res.get_json()
    assert body["valid"] is True, body
    assert body["ingest_issues"] == []
    assert body["gate1"]["passed"]
    assert body["gate3"]["passed"]


def test_unknown_measure_reference_fails(client):
    spec, model = _retail_payload()
    spec = copy.deepcopy(spec)
    spec["pages"][0]["visuals"][0]["measures"] = ["Not A Real Measure"]

    res = client.post("/api/validate", json={
        "dashboard_spec": spec, "semantic_model": model,
    })
    body = res.get_json()
    assert body["valid"] is False
    assert any("Not A Real Measure" in issue for issue in body["ingest_issues"]), body


def test_malformed_payload_reports_error_not_500(client):
    res = client.post("/api/validate", json={"dashboard_spec": {"pages": []}})
    assert res.status_code == 200
    body = res.get_json()
    assert body["valid"] is False
    assert "error" in body


def test_validate_cleans_up_artifact_dir(client, tmp_path):
    spec, model = _retail_payload()
    client.post("/api/validate", json={
        "dashboard_spec": spec, "semantic_model": model,
    })
    # No validate_* directories should survive the request.
    leftover = [p for p in tmp_path.iterdir() if p.name.startswith("validate_")]
    assert leftover == [], leftover
