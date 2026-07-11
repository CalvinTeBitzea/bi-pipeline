"""
WHAT THIS FILE IS, IN BUSINESS TERMS
--------------------------------------
Automated tests for lib/skills.py's template registry and token-fill engine
— the mechanism that lets a designer's hand-authored visual template
(a "skill," in the visual-template sense — see pbip_builder.py's top-of-file
note for the other meaning of that word) get reliably reused across many
different reports. These tests exist to catch a broken or incomplete
template file BEFORE it ever reaches a real build — the software equivalent
of proofreading a form letter template for leftover "[INSERT NAME HERE]"
placeholders before it goes out to real customers.

Unit tests for the skill registry + token-fill.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from lib import skills  # noqa: E402


@pytest.fixture(scope="module")
def registry():
    # `scope="module"` means this fixture is built ONCE and reused across
    # every test function in this file, rather than freshly rebuilt for
    # each one — a reasonable optimization here since loading the skill
    # registry from disk is read-only and doesn't get mutated by any test.
    return skills.load_skills()


def test_loads_known_skills(registry):
    assert "line-column-combo-chart" in registry


def test_resolve_explicit_skill(registry):
    sk = skills.resolve_skill({"skill": "line-column-combo-chart"}, registry)
    assert sk is not None and sk.name == "line-column-combo-chart"


def test_resolve_unknown_returns_none(registry):
    # A visual naming a skill that doesn't exist, or naming no skill at
    # all, should cleanly fall back to "no skill" rather than raising an
    # error — the caller (pbip_builder.py) is expected to handle `None` by
    # using its own generic fallback builder instead.
    assert skills.resolve_skill({"skill": "does-not-exist"}, registry) is None
    assert skills.resolve_skill({}, registry) is None


def test_example_tokens_cover_all_referenced_tokens(registry):
    # Every <TOKEN> used in template files should have an example in the token table.
    # This is the "proofread the template" check: if a designer adds a new
    # `<TOKEN>` to a template file but forgets to document an example value
    # for it in the Token Table, this test fails immediately — rather than
    # that gap only being discovered later when a real build mysteriously
    # produces an unfilled placeholder.
    for sk in registry.values():
        missing = sk.tokens - set(sk.example_tokens())
        assert not missing, f"{sk.name} missing example tokens: {missing}"


def test_fill_produces_valid_json(registry):
    # For every skill, confirm filling it with its OWN documented example
    # values produces output with no leftover `<TOKEN>` placeholders, and
    # that every `.json` template file is still valid JSON after
    # substitution (a token filled with an unescaped special character could
    # otherwise silently corrupt the JSON structure).
    for sk in registry.values():
        filled = skills.fill(sk, sk.example_tokens())
        for rel, text in filled.items():
            assert "<" not in text or ">" not in text or not skills.TOKEN_RE.search(text)
            if rel.endswith(".json"):
                json.loads(text)  # raises on invalid


def test_fill_raises_on_missing_token(registry):
    # The safety-net behavior itself, under direct test: calling fill() with
    # NO tokens supplied at all must raise an error rather than silently
    # producing a file full of literal `<TOKEN>` text.
    sk = registry["line-column-combo-chart"]
    with pytest.raises(ValueError):
        skills.fill(sk, {})  # no tokens supplied


def test_id_helpers_format():
    # Confirms each ID-generating helper produces a string in the EXACT
    # shape/length Power BI's file format expects for that specific field
    # (a standard 36-character UUID string, a 32-character hex string, or a
    # 20-character one) — a subtle format mismatch here could otherwise
    # produce a file that looks fine but Power BI Desktop quietly rejects.
    assert len(skills.new_lineage_tag()) == 36 and skills.new_lineage_tag().count("-") == 4
    assert len(skills.new_pbi_id()) == 32
    assert len(skills.new_visual_name()) == 20
