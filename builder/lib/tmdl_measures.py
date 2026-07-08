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
# This module is the fix: it turns semantic_model.json's measures into a
# real TMDL table, either by hand (the zip/README path,
# `measures_tmdl_by_table`) or automatically (the direct-write path in
# builder/app.py's /api/build-manifest and agent/lib/localWrite.js).
#
# CONCEPT: A single, dedicated "measures table" — not scattered per-table
# -------------------------------------------------------------------------
# An earlier version of this file put each measure into ITS OWN data
# table's .tmdl file (e.g. a "Net Revenue" measure filed under the real
# Fact_Sales table it's about). That's technically valid, but it's not how
# most real-world Power BI models are organized in practice — measures get
# scattered across whichever table each is conceptually "about," making
# them hard to find as a model grows. The standard, widely-recommended
# convention instead is ONE dedicated, disconnected table (commonly named
# `_Measures`) that holds EVERY measure regardless of what it's about,
# purely so the Fields list has one obvious place to look. This is exactly
# the pattern Microsoft's own skill template already uses for a similar
# purpose — see pbi-skills/line-column-combo-chart/templates/measures-
# table.tmdl and its SKILL.md, whose own worked example literally names the
# table `_Measures` (with a leading underscore, both to make it sort to the
# top of the Fields list and as a naming convention signaling "not a data
# table"). This module follows that same convention for ALL of a report's
# measures, not just a skill's own helper ones.
#
# CONCEPT: Why a measure's "home table" doesn't matter functionally
# -------------------------------------------------------------------------
# It's safe to move every measure into one shared table because a DAX
# measure's "home table" is purely organizational, not a scoping rule:
# every column reference in the generated DAX is already fully qualified
# (`'RealTable'[Column]`, never a bare `[Column]`), and measure-to-measure
# references (`[Other Measure]`) resolve by name globally across the whole
# model regardless of which table either measure is filed under. Nothing
# about the DAX itself changes — only where Power BI Desktop's Fields list
# shows it.
#
# CONCEPT: Why a "measures table" needs a dummy column at all
# -------------------------------------------------------------------------
# A TMDL/Power BI table can't exist with ONLY measures and nothing else —
# it needs to be a structurally real table. The fix (again matching
# Microsoft's own template) is a single placeholder column backed by a
# trivial calculated partition (`Row("Column", BLANK())` — a one-row,
# one-column table with a blank value) that's never meant to be seen or
# used; it exists purely so the table is valid, with the real measures
# riding alongside it.
import uuid

# The one dedicated table every report's measures always go into. Matches
# Microsoft's own skill template's example value exactly (see SKILL.md's
# Token Table: `<MEASURE_TABLE>` -> `_Measures`).
MEASURES_TABLE_NAME = "_Measures"

# The exact line that has to exist in the SemanticModel's top-level
# model.tmdl for Power BI Desktop to actually load this table — a TMDL
# table file on disk isn't enough by itself; every table also needs a
# `ref table <Name>` entry in the model's own index. Unquoted, matching the
# real resolved example in the skill's worked-example.md (quoting is only
# required in TMDL when a name contains spaces or symbols; `_Measures` needs
# none).
MODEL_REF_LINE = f"ref table {MEASURES_TABLE_NAME}"


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
    """Every measure, individually rendered, all filed under the one
    MEASURES_TABLE_NAME — regardless of semantic_model.json's own
    `home_table` for each (see the CONCEPT note above for why that's safe).
    Returns {MEASURES_TABLE_NAME: [{"name":..., "block":...}, ...]}, kept as
    a dict (rather than just a list) so the direct-write path can merge and
    de-duplicate one measure at a time against whatever's already in an
    existing `_Measures.tmdl` from an earlier build — see
    agent/lib/localWrite.js."""
    return {
        MEASURES_TABLE_NAME: [
            {"name": m["name"], "block": _measure_block(m)} for m in measures
        ]
    }


def build_measures_table_tmdl(measures: list[dict]) -> str:
    """Full TMDL for a BRAND NEW `_Measures` table: the table declaration,
    every measure's block, and the minimal placeholder column + calculated
    partition every TMDL table structurally needs (see the CONCEPT note
    above) — matches Microsoft's own skill template
    (pbi-skills/line-column-combo-chart/templates/measures-table.tmdl)
    field for field, just with every one of THIS report's real measures
    instead of that template's two example ones."""
    lines = [
        f"table '{MEASURES_TABLE_NAME}'",
        f"\tlineageTag: {uuid.uuid4()}",
        "",
    ]
    for m in measures:
        lines.append(_measure_block(m))
        lines.append("")
    lines += [
        "\tcolumn Column",
        "\t\tformatString: 0",
        f"\t\tlineageTag: {uuid.uuid4()}",
        "\t\tsummarizeBy: sum",
        "\t\tisNameInferred",
        "\t\tsourceColumn: [Column]",
        "",
        "\t\tannotation SummarizationSetBy = Automatic",
        "",
        f"\tpartition '{MEASURES_TABLE_NAME}' = calculated",
        "\t\tmode: import",
        '\t\tsource = Row("Column", BLANK())',
        "",
        f"\tannotation PBI_Id = {uuid.uuid4().hex}",
        "",
        f"\tannotation {uuid.uuid4()} = {{\"Expression\":\"\"}}",
    ]
    return "\n".join(lines)


def measures_tmdl_by_table(measures: list[dict]) -> list[tuple[str, str]]:
    """(zip/README download path) Returns the ONE new table file's full,
    ready-to-drop-in content — [(filename, tmdl_text)] shaped to match
    pbip_builder.py's existing tmdl_fragments handling, but with exactly one
    entry rather than one per real data table. Empty list if there are no
    measures at all."""
    if not measures:
        return []
    return [(f"{MEASURES_TABLE_NAME}.tmdl", build_measures_table_tmdl(measures))]
