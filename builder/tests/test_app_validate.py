"""
WHAT THIS FILE IS, IN BUSINESS TERMS
--------------------------------------
Automated tests for the `/api/validate` endpoint (builder/app.py) — the exact
endpoint bi-authoring calls every time it checks an AI-generated design. This
file's job is to prove, automatically and repeatably, that this critical
endpoint behaves correctly: a good design gets approved, and — just as
important — a genuinely broken design gets REJECTED with a useful, specific
explanation rather than either crashing or (worse) silently reporting
success on bad data.

CONCEPT: Automated tests — why write code that checks other code
-------------------------------------------------------------------------
A test is a small program that runs a piece of real code with a KNOWN input
and checks the output against what you expect. The value isn't in confirming
it works once — it's in being able to re-run every test in seconds, any time
you change something, and immediately know if you accidentally broke
behavior that used to work. Without tests, "did my change break anything?"
can only be answered by manually re-checking by hand, which gets slower and
less reliable as a codebase grows.

POST /api/validate — the bi-authoring subagent's validate_ir tool endpoint.

Reuses the retail golden example: a valid case (should pass all gates) and a
deliberately broken case (an unknown measure reference, the kind of mistake a
design-generating agent could plausibly make) to prove the endpoint surfaces
real, actionable failures rather than always reporting success.

CONCEPT: pytest — the testing framework running these checks
-------------------------------------------------------------------------
`pytest` is the most widely used Python testing tool. Any function whose
name starts with `test_` is automatically discovered and run as one
independent test. A `@pytest.fixture` (like `client` below) is a reusable
piece of setup — here, "a working, isolated copy of the Flask app to send
fake requests to" — that pytest automatically builds fresh and hands to
every test function that asks for it by naming it as a parameter.
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
    # CONCEPT: Isolating a test from the real filesystem/environment
    # `tmp_path` is a pytest-provided, automatically-cleaned-up scratch
    # folder — a brand new empty directory for every single test, deleted
    # afterward. `monkeypatch` temporarily REDIRECTS where the artifact
    # store writes files (normally `builder/artifacts/`) to point at that
    # scratch folder instead, just for the duration of this one test. This
    # is what makes tests safe to run repeatedly and in parallel: they never
    # touch real build artifacts or leave stray files behind.
    monkeypatch.setattr(store, "_BASE", tmp_path)
    flask_app.app.testing = True
    return flask_app.app.test_client()


def _retail_payload():
    # The "golden example": a real, hand-verified, known-good retail report
    # spec kept in the repo specifically so tests have a realistic, stable
    # input to check against — much more meaningful than a trivial made-up
    # example, since it's the same shape of input a real user would send.
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
    # Deliberately corrupt an otherwise-valid spec with exactly the kind of
    # mistake a design-generating AI agent might plausibly make (referencing
    # a measure name that doesn't actually exist), then confirm the endpoint
    # catches it and explains WHY, by name — not just "something's wrong."
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
    # Confirms the endpoint reports failure the way the CALLING AGENT
    # actually expects (a normal 200 response with valid:false/error in the
    # body — see builder/app.py's docstring on this), rather than a raw
    # HTTP 500 error page a tool-calling AI model wouldn't know how to parse.
    res = client.post("/api/validate", json={"dashboard_spec": {"pages": []}})
    assert res.status_code == 200
    body = res.get_json()
    assert body["valid"] is False
    assert "error" in body


def test_validate_cleans_up_artifact_dir(client, tmp_path):
    # A validation request is meant to be STATELESS from the caller's
    # perspective — it shouldn't leave scratch files behind on the server
    # after it's done answering. This test proves that cleanup guarantee
    # actually holds.
    spec, model = _retail_payload()
    client.post("/api/validate", json={
        "dashboard_spec": spec, "semantic_model": model,
    })
    # No validate_* directories should survive the request.
    leftover = [p for p in tmp_path.iterdir() if p.name.startswith("validate_")]
    assert leftover == [], leftover
