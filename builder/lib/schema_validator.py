# WHAT THIS FILE IS, IN BUSINESS TERMS
# -------------------------------------
# The "rulebook checker" for the two AI-authored files (dashboard_spec.json
# and semantic_model.json). Before this pipeline trusts either file enough
# to act on it, it checks the file's SHAPE against a formal, written-down
# rulebook (a "JSON Schema" — see builder/schemas/) describing exactly what
# fields must exist, what type each one must be, and so on. This is the
# first, most basic layer of defense against a malformed AI output silently
# causing confusing failures three steps later — the same principle as a
# form that rejects an obviously invalid entry (a letter in a phone number
# field) immediately, rather than only discovering the problem when
# something downstream tries to use it.
#
# CONCEPT: JSON Schema — a formal, machine-checkable rulebook for JSON shape
# -------------------------------------------------------------------------
# A JSON Schema is itself just a JSON file that describes what OTHER JSON
# files are allowed to look like (required fields, allowed types, nested
# structure) — similar to how a spreadsheet's data-validation rules describe
# what's allowed to go in each column. The `jsonschema` library (a
# third-party package, not custom code) is what actually performs the
# check; this file is a thin, convenience wrapper around it.
import json
from pathlib import Path
import jsonschema

_SCHEMA_DIR = Path(__file__).parent.parent / "schemas"
_cache: dict = {}


def _load(schema_name: str) -> dict:
    # Schemas are read from disk once and kept in memory afterward
    # (`_cache`) — they never change during a build, so re-reading the same
    # file from disk on every single validation call would be pure waste.
    if schema_name not in _cache:
        path = _SCHEMA_DIR / f"{schema_name}.json"
        _cache[schema_name] = json.loads(path.read_text())
    return _cache[schema_name]


def validate(schema_name: str, data: dict) -> None:
    """Raises jsonschema.ValidationError if data fails the schema."""
    jsonschema.validate(instance=data, schema=_load(schema_name))


def is_valid(schema_name: str, data: dict) -> bool:
    # A convenience variant for callers that just want a yes/no answer
    # rather than having to catch an exception themselves.
    try:
        validate(schema_name, data)
        return True
    except jsonschema.ValidationError:
        return False
