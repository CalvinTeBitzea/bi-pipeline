"""
WHAT THIS FILE IS, IN BUSINESS TERMS
--------------------------------------
This is the "template library" for visuals that deserve better, more
polished output than the plain generic builder (`_build_visual_json` in
agents/pbip_builder.py) produces on its own — e.g. a combo bar+line chart,
which needs a more specific shape than the generic type-map logic knows how
to build. A DESIGNER hand-authors one of these templates once; this file is
what lets the builder reuse it, correctly filled in for THIS report's actual
tables and measures, over and over.

REMINDER: "skill" here is the VISUAL-TEMPLATE meaning, NOT an Anthropic
Managed Agents Skill — see the top-of-file note in agents/pbip_builder.py
for why this codebase uses the same word for two unrelated things.

Skill registry + token-fill.

A skill (`pbi-skills/<name>/`) is a validated, token-templated PBIR/TMDL recipe:
  SKILL.md  — frontmatter (name, description), a Token Table, an Ordered File Map
  templates/ — *.visual.json and *.tmdl with <TOKEN> placeholders
  examples/worked-example.md

This module loads skills into a registry, resolves which skill builds a given IR
visual, and fills a skill's templates from a token dict (the builder supplies
geometry from IR `layout`, fields from the semantic model, display from
`skill_params`, and fresh lineage/annotation IDs).

CONCEPT: Template + token substitution (the "mail merge" pattern)
-------------------------------------------------------------------------
A skill's template files are mostly complete, valid `visual.json`/`.tmdl`
content, except for a handful of placeholder tokens written as
`<UPPER_SNAKE_CASE>` — e.g. `<CHART_TITLE>`, `<VOLUME_MEASURE_NAME>`. `fill()`
below does the substitution: swap every `<TOKEN>` for its real value, and
refuse to proceed if any token was left unfilled (a strong safety net —
better to fail loudly with "you forgot to supply X" than silently ship a
file with a literal `<CHART_TITLE>` string still in it).
"""
from __future__ import annotations

import json
import re
import uuid
from pathlib import Path

from lib import mdutil

PBI_SKILLS_DIR = Path(__file__).parent.parent / "pbi-skills"

# Tokens are UPPER_SNAKE inside angle brackets, e.g. <CHART_X>, <VOLUME_MEASURE_NAME>
TOKEN_RE = re.compile(r"<([A-Z0-9_]+)>")


class Skill:
    """In-memory representation of one loaded skill folder — its metadata
    (name/description), its raw documentation body, and every template file
    it owns (still with unfilled `<TOKEN>` placeholders in them at this
    point; see `fill()` below for the step that actually substitutes real
    values)."""
    def __init__(self, name: str, description: str, body: str,
                 templates: dict[str, str], path: Path):
        self.name = name
        self.description = description
        self.body = body                 # SKILL.md minus frontmatter
        self.templates = templates       # {relpath: text}, e.g. "templates/combo-chart.visual.json"
        self.path = path

    @property
    def tokens(self) -> set[str]:
        """Every token referenced across this skill's template files."""
        found: set[str] = set()
        for txt in self.templates.values():
            found.update(TOKEN_RE.findall(txt))
        return found

    def example_tokens(self) -> dict[str, str]:
        """Token → example value, parsed from the SKILL.md Token Table.
        Handles grouped rows like `<A> / <B>` with examples `1 / 2`.

        These example values double as SAFE DEFAULTS: `_skill_tokens` in
        agents/pbip_builder.py starts from this exact dict and only
        overrides the specific tokens it actually has real data for (fields,
        geometry, IDs), leaving the designer-authored example values in
        place for anything more cosmetic (e.g. axis-label formatting) that
        this report's data doesn't need to override.
        """
        rows = mdutil.parse_table(mdutil.extract_section(self.body, "Token Table"))
        out: dict[str, str] = {}
        for r in rows:
            names = [n.strip() for n in r.get("Token", "").split("/")]
            examples = [e.strip() for e in r.get("Example", "").split("/")]
            for i, raw in enumerate(names):
                m = TOKEN_RE.search(raw)
                if not m:
                    continue
                val = examples[i] if i < len(examples) else (examples[0] if examples else "")
                out[m.group(1)] = val.strip("`")
        return out

    def __repr__(self) -> str:
        return f"<Skill {self.name} ({len(self.templates)} templates)>"


def load_skills(root: Path = PBI_SKILLS_DIR) -> dict[str, Skill]:
    """Scan `root` for `*/SKILL.md` and build the registry keyed by skill name.

    This is a one-time "index the library" pass — walk every subfolder,
    read its SKILL.md and template files off disk, and hold them all in
    memory as `Skill` objects so the rest of the builder can look one up by
    name instantly rather than re-reading files from disk on every visual.
    """
    registry: dict[str, Skill] = {}
    if not root.is_dir():
        return registry
    for d in sorted(p for p in root.iterdir() if p.is_dir()):
        skill_md = d / "SKILL.md"
        if not skill_md.is_file():
            continue
        fm, body = mdutil.parse_frontmatter(skill_md.read_text())
        name = fm.get("name", d.name)
        templates: dict[str, str] = {}
        tdir = d / "templates"
        if tdir.is_dir():
            for f in sorted(tdir.rglob("*")):
                if f.is_file():
                    templates[str(f.relative_to(d))] = f.read_text()
        registry[name] = Skill(name, fm.get("description", ""), body, templates, d)
    return registry


def resolve_skill(visual: dict, registry: dict[str, Skill]) -> Skill | None:
    """Pick the skill that builds this IR visual. Explicit `skill` wins; otherwise
    None ⇒ caller falls back to the minimal builder path.

    Skill selection is intentionally NOT automatic/guessed — the AI design
    stage explicitly names which skill a visual should use (via the IR's
    `skill` field, e.g. "line-column-combo-chart"), the same way a person
    filling out an order form picks an exact product code rather than the
    system guessing what they probably meant.
    """
    name = visual.get("skill")
    if name and name in registry:
        return registry[name]
    return None


def fill(skill: Skill, tokens: dict) -> dict[str, str]:
    """Substitute `tokens` into every template file. Raises if any `<TOKEN>` is
    left unfilled, or if a `.json` template no longer parses. Returns
    {relpath: filled_text}."""
    out: dict[str, str] = {}
    for rel, txt in skill.templates.items():
        filled = TOKEN_RE.sub(lambda m: str(tokens.get(m.group(1), m.group(0))), txt)
        leftover = sorted(set(TOKEN_RE.findall(filled)))
        if leftover:
            raise ValueError(f"{skill.name}/{rel}: unfilled tokens {leftover}")
        if rel.endswith(".json"):
            try:
                json.loads(filled)
            except json.JSONDecodeError as e:
                raise ValueError(f"{skill.name}/{rel}: invalid JSON after fill: {e}") from e
        out[rel] = filled
    return out


# ── ID helpers (PBIR requires fresh lineage tags + annotation IDs) ──────────────
# Power BI's file format expects certain fields to be globally unique
# identifiers (so it can track, e.g., "this specific visual" even if it gets
# renamed) — these three helpers are just different flavors of "generate a
# fresh random unique ID," each formatted the way a particular field expects
# it (a standard UUID string, a 32-character hex string, or a shorter
# 20-character one).

def new_lineage_tag() -> str:
    """UUID for lineageTag fields."""
    return str(uuid.uuid4())


def new_pbi_id() -> str:
    """32-char hex for PBI annotation IDs."""
    return uuid.uuid4().hex


def new_visual_name() -> str:
    """20-char hex visual-container name."""
    return uuid.uuid4().hex[:20]


if __name__ == "__main__":
    # A self-test: load every skill on disk and confirm each one's own
    # documented EXAMPLE values are enough to fill it completely without
    # error — a quick way to catch a broken/miswritten skill template during
    # development, independent of running the whole pipeline.
    reg = load_skills()
    print(f"loaded {len(reg)} skills: {list(reg)}")
    for name, sk in reg.items():
        print(f"\n{name}: {len(sk.tokens)} tokens across {len(sk.templates)} files")
        try:
            filled = fill(sk, sk.example_tokens())
            json_files = [r for r in filled if r.endswith('.json')]
            print(f"  fill() OK — {len(filled)} files ({len(json_files)} json validated)")
        except ValueError as e:
            print(f"  fill() FAILED: {e}")
