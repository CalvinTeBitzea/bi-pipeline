"""
WHAT THIS FILE IS, IN BUSINESS TERMS
--------------------------------------
A small set of text-parsing helpers used to read the "skill" template files
(see lib/skills.py — the VISUAL-TEMPLATE meaning of "skill," not the AI
Skills API meaning; see pbip_builder.py's top-of-file note for that
distinction). Those skill files are written as ordinary Markdown documents
(with a small metadata header and tables) BECAUSE that's a genuinely
convenient, human-editable authoring format for a designer to hand-write a
new chart template in — this file is what lets code reach back INTO that
human-friendly document and pull out just the structured pieces (a name,
description, and a token/example table) that the builder needs to actually
use it.

Tiny markdown helpers shared by the skill and template registries.

SKILL.md and TEMPLATE.md are authored as human-readable markdown with YAML-ish
frontmatter, GitHub-style tables, and `##` sections. These helpers parse just
enough of that to drive the registries — no full markdown dependency.

CONCEPT: "Frontmatter" — small structured metadata at the top of a document
-------------------------------------------------------------------------
Frontmatter is a common convention (used by this project, and by many
static-site/blogging tools) for attaching a few key-value facts to an
otherwise free-form document, set off by `---` lines at the very top:

    ---
    name: combo-chart
    description: A bar+line combo visual
    ---
    ## Rest of the document as normal prose...

`parse_frontmatter` below is what splits a file into "the metadata" and "the
rest of the document" — it deliberately only understands simple `key: value`
lines, not full YAML syntax, since that's all this project's own files
actually use.
"""
import re

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Split leading `--- ... ---` frontmatter from the body.

    Returns (frontmatter_dict, body). Frontmatter is parsed as simple
    `key: value` lines (no nested YAML). If absent, returns ({}, text).
    """
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    fm: dict[str, str] = {}
    for line in m.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, val = line.partition(":")
        fm[key.strip()] = val.strip()
    return fm, text[m.end():]


def extract_section(text: str, heading_substr: str) -> str:
    """Return the body of the first `##`/`###` section whose title contains
    `heading_substr` (case-insensitive), up to the next heading of level <= 2.
    Empty string if not found.

    This is how lib/skills.py finds the "Token Table" section inside a
    SKILL.md file without needing to know exactly where in the document it
    appears — it just searches for a matching heading and reads until the
    next one, the same way a person skimming a document's table of contents
    would jump straight to a named section.
    """
    lines = text.splitlines()
    start = None
    for i, line in enumerate(lines):
        if re.match(r"^#{1,6}\s", line) and heading_substr.lower() in line.lower():
            start = i + 1
            break
    if start is None:
        return ""
    out = []
    for line in lines[start:]:
        if re.match(r"^#{1,2}\s", line):  # next top-level/section heading ends it
            break
        out.append(line)
    return "\n".join(out)


def parse_table(chunk: str) -> list[dict]:
    """Parse the first GitHub-style markdown table found in `chunk`.

    Returns a list of row dicts keyed by header cell text. Cells are stripped.
    The `|---|` separator row is skipped. Returns [] if no table is present.

    A Markdown table like:
        | Token | Example |
        |-------|---------|
        | <FOO> | 42      |
    becomes `[{"Token": "<FOO>", "Example": "42"}]` — one dict per data row,
    keyed by the header text, the same shape you'd get reading a CSV file
    into a list of dicts.
    """
    rows = [ln for ln in chunk.splitlines() if ln.strip().startswith("|")]
    if len(rows) < 2:
        return []

    def cells(line: str) -> list[str]:
        parts = line.strip().split("|")
        # drop the empty strings produced by leading/trailing pipes
        return [p.strip() for p in parts[1:-1]] if len(parts) >= 2 else []

    header = cells(rows[0])
    out = []
    for line in rows[2:]:  # skip header + separator
        c = cells(line)
        if not c or set("".join(c)) <= set("-: "):
            continue
        out.append({header[i]: (c[i] if i < len(c) else "") for i in range(len(header))})
    return out
