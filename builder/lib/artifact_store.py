# WHAT THIS FILE IS, IN BUSINESS TERMS
# -------------------------------------
# The builder's "filing cabinet." Every build gets its own folder (named
# after its `build_id`) under `artifacts/`, holding every intermediate and
# final file that build produced — the validated IR, the build result
# summary, and a small marker file per completed stage. This is what lets
# conductor.py's `_step` helper skip a stage that's already finished (see
# `is_stage_done`/`mark_stage_done` below) — a simple, file-based way of
# remembering "how far did this build get" without needing an actual
# database.
#
# CONCEPT: A "marker file" as the simplest possible way to record a fact
# -------------------------------------------------------------------------
# `mark_stage_done` doesn't write any actual content — it just creates an
# empty file named e.g. `.ingest.done`. `is_stage_done` then just checks
# whether that file EXISTS. This is a deliberately minimal way to record a
# yes/no fact ("did this finish?") on disk, without needing a database or
# even any file content — the file's mere presence IS the answer.
import json
import os
from pathlib import Path

# Where all builds' artifacts live — overridable via an environment variable
# (e.g. to point at a different disk/volume in a deployed environment),
# defaulting to a folder alongside this code when not set.
_BASE = Path(os.environ.get("ARTIFACT_ROOT", str(Path(__file__).parent.parent / "artifacts")))


def artifact_path(build_id: str, filename: str) -> Path:
    return _BASE / build_id / filename


def write_artifact(build_id: str, filename: str, data: dict) -> Path:
    path = artifact_path(build_id, filename)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))
    return path


def read_artifact(build_id: str, filename: str) -> dict:
    return json.loads(artifact_path(build_id, filename).read_text())


def artifact_exists(build_id: str, filename: str) -> bool:
    return artifact_path(build_id, filename).exists()


def mark_stage_done(build_id: str, stage: str) -> None:
    path = artifact_path(build_id, f".{stage}.done")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch()


def is_stage_done(build_id: str, stage: str) -> bool:
    return artifact_path(build_id, f".{stage}.done").exists()
