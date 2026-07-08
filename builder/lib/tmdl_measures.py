# WHAT THIS FILE IS, IN BUSINESS TERMS
# -------------------------------------
# Closes a real gap: semantic_model.json (authored by bi-design, checked by
# bi-authoring) already contains every measure's name, home table, DAX
# formula, and display format — but until now, nothing in the builder ever
# turned that into an actual, pasteable measure definition. pbip_builder.py
# only ever used semantic_model.json to make each VISUAL correctly
# REFERENCE a measure by name (see its `_measure_projection` function); the
# measure's real DAX formula never left semantic_model.json. A user opening
# the built report in Power BI Desktop would see visuals correctly wired up
# to fields that don't actually exist yet in the connected data model.
#
# This module is the fix: it turns semantic_model.json's measures into real
# TMDL `measure` blocks, grouped by which table they belong to, so they can
# be pasted directly into the matching table's .tmdl file in the user's
# existing .SemanticModel project — either by hand (the zip/README path,
# `measures_tmdl_by_table`) or automatically (the direct-write path in
# builder/app.py's /api/build-manifest, which uses the finer-grained
# `measure_blocks_by_table` so the browser can merge and de-duplicate one
# measure at a time rather than one all-or-nothing file at a time).
#
# CONCEPT: A "fragment," not a full model file — merge, don't replace
# -------------------------------------------------------------------------
# The user's SemanticModel project already exists, with real data-source
# connections, columns, and partitions Power BI Desktop generated when they
# first connected it — none of that is something this pipeline has any
# business overwriting. So this deliberately produces MEASURE-ONLY
# fragments (matching the exact style already used by this pipeline's own
# skill templates — see pbi-skills/time-window-highlight/templates/
# measures-window-additions.tmdl for a hand-authored example of the same
# shape) meant to be pasted INSIDE an existing `table '<Name>' { ... }`
# block, not a replacement for the whole table file.
import uuid


def _measure_lines(name: str, dax: str) -> list[str]:
    """Render one `measure` block's declaration + DAX body.

    CONCEPT: TMDL's indentation-sensitive multi-line expressions
    -------------------------------------------------------------------------
    Simple DAX fits on the `measure 'Name' = <DAX>` line itself. But
    bi-design regularly writes multi-line VAR/RETURN expressions (e.g. for
    MoM/YoY calculations) — see the worked example in
    pbi-skills/*/templates/measures-table.tmdl, which shows the real
    convention for this: put `measure 'Name' =` alone on its own line, then
    indent the ENTIRE expression body one level deeper than this measure's
    own property lines (`formatString`/`lineageTag`, at +1 tab) — i.e. +2
    tabs total. Without that extra indentation, a TMDL parser can't tell
    where the expression ends and the next property begins. Each line is
    re-indented from scratch (not just prefixed) because the DAX as authored
    uses plain spaces for its own internal nesting, which doesn't carry any
    TMDL meaning — only the tab depth relative to `measure` does.
    """
    dax_lines = dax.strip("\n").split("\n")
    if len(dax_lines) == 1:
        return [f"\tmeasure '{name}' = {dax_lines[0].strip()}"]
    lines = [f"\tmeasure '{name}' ="]
    lines += [f"\t\t\t{dl.strip()}" for dl in dax_lines]
    return lines


def _measure_block(m: dict) -> str:
    """Render ONE measure's complete TMDL block (description + declaration +
    properties), as a single string with no trailing blank line — callers
    decide their own spacing between measures."""
    lines: list[str] = []
    # TMDL's own convention for a human-readable description: a `///`
    # doc-comment line directly above the object it describes — has to come
    # BEFORE the `measure` line itself, not mixed in with its indented
    # properties.
    if m.get("description"):
        lines.append(f"\t/// {m['description']}")
    lines += _measure_lines(m["name"], m["dax"])
    if m.get("format_string"):
        lines.append(f"\t\tformatString: {m['format_string']}")
    lines.append(f"\t\tlineageTag: {uuid.uuid4()}")
    return "\n".join(lines)


def measure_blocks_by_table(measures: list[dict]) -> dict[str, list[dict]]:
    """Group semantic_model.json's measures by `home_table`, with each
    measure rendered individually. Returns {table: [{"name": ..., "block":
    "..."}]} — the per-measure granularity the direct-write path needs to
    merge and de-duplicate one measure at a time (see
    builder/app.py's /api/build-manifest and agent/lib/localWrite.js),
    rather than having to treat a whole table's measures as one
    indivisible, all-or-nothing chunk of text."""
    by_table: dict[str, list[dict]] = {}
    for m in measures:
        by_table.setdefault(m["home_table"], []).append(m)
    return {
        table: [{"name": m["name"], "block": _measure_block(m)} for m in table_measures]
        for table, table_measures in sorted(by_table.items())
    }


def measures_tmdl_by_table(measures: list[dict]) -> list[tuple[str, str]]:
    """Group semantic_model.json's measures by `home_table` and render each
    group as one TMDL fragment FILE (for the zip/README download path,
    where a user pastes one whole file's contents by hand). Returns
    [(filename, tmdl_text), ...], one entry per table that has at least one
    measure — matching the same (filename, content) shape pbip_builder.py
    already collects skill-shipped TMDL fragments in, so both flow through
    the exact same downstream path (result["tmdl_fragments"] ->
    builder/app.py's zip `tmdl/` folder).
    """
    by_table = measure_blocks_by_table(measures)

    fragments: list[tuple[str, str]] = []
    for table, blocks in by_table.items():
        lines = [
            f"// Measures for table '{table}', generated from semantic_model.json.",
            f"// Paste these {len(blocks)} measure block(s) inside the existing",
            f"// `table '{table}'` definition in your .SemanticModel project",
            f"// (definition/tables/{table}.tmdl) — do not replace the whole file.",
            "",
        ]
        for b in blocks:
            lines.append(b["block"])
            lines.append("")
        fragments.append((f"measures_{table}.tmdl", "\n".join(lines)))
    return fragments
