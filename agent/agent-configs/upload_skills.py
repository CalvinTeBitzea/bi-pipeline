"""
WHAT THIS SCRIPT IS, IN BUSINESS TERMS
---------------------------------------
This script takes Microsoft's own published best-practice guides for
building Power BI reports — chart-selection advice, layout conventions, DAX
patterns, and so on — and uploads them as reference material our AI agents
can consult while they work. Without this, our agents were only working off
of instructions I hand-wrote by *reading* those guides myself once and
summarizing what I learned into their prompts — useful, but a one-time,
lossy translation. This script makes the original, detailed material itself
a live resource the agents can open and read at the moment they need it,
every single run, on any machine.

CONCEPT: "Skills" — giving an agent a reference library, not just instructions
--------------------------------------------------------------------------------
A system prompt is like a job description: fixed instructions the agent
always has in mind. A "Skill" (Anthropic's Managed Agents Skills feature) is
more like handing the agent a reference manual it can pull off the shelf
mid-task: a bundle of files (guides, examples, tables) that gets mounted
into the agent's sandboxed workspace at a known folder path, which the agent
can then browse and read using its normal file tools — the same way a human
consultant might keep a style guide on their desk and flip to the relevant
page instead of memorizing the whole thing. The agent decides when it's
relevant and pulls in only what it needs (this is often called "progressive
disclosure" — start with just the reference material's summary/index, only
read the full detail file for the current sub-decision).

CONCEPT: Why "upload a copy" instead of "just point at the source"?
-------------------------------------------------------------------------
This material actually lives on MY laptop right now — it's a plugin I
installed for my own use in Claude Code, downloaded from a public GitHub
repo (microsoft/skills-for-fabric). The cloud agents in this pipeline can't
reach my laptop's filesystem, and pointing them at "a GitHub repo" isn't a
supported thing for this API — so the fix is to package the files and
`upload` them to Anthropic's platform as a first-class, permanent Skill
object. Once uploaded, the material lives on Anthropic's side and is
available to any agent, from any machine, forever — solving both the
"my laptop isn't reachable" problem and the "what if I switch to my work
computer" problem in one move.

CONCEPT: Editing borrowed material responsibly (adapting, not just copying)
--------------------------------------------------------------------------------
Two things get stripped from the original files before upload, and BOTH are
done by transforming the text in memory — the original files on disk are
never touched, so this can be re-run any time the plugin updates upstream:

  1. An "Update Check" instruction block, present in every skill's main
     file, tells an interactive coding assistant (a human typing to Claude
     Code, Cursor, etc.) to check if a newer version of the guide is
     available. That instruction is meaningless for a fully automated
     production agent that never has a human "session" to check anything in
     — so it's just noise, and noise in a prompt costs both money (every
     token an agent reads costs money) and can distract the model from the
     content that actually matters.

  2. For the Power BI *authoring* skill specifically, several sections
     describe using a command-line tool (`powerbi-report-author`) and a
     bridge to a running, real, Windows copy of Power BI Desktop
     (`powerbi-desktop`) to directly manipulate report files and take
     screenshots for a human to review. Our authoring agent has no ability
     to run shell commands, and even if it did, Power BI Desktop is a
     Windows-only visual application with no "headless"/server mode — it
     physically cannot run inside a cloud container. Rather than leave in
     instructions the agent can never follow (which risks it trying and
     failing, or getting confused), those specific sections are surgically
     removed, while everything else in that same guide (formatting rules,
     anti-pattern tables, layout conventions) is kept, because that
     reference knowledge is still fully useful even without the tooling
     around it.

Source: Claude Code plugin cache for the "fabric-collection" marketplace
(https://github.com/microsoft/skills-for-fabric.git), NOT this repo — these files are
local to this machine, hence packaging + uploading them as first-class Anthropic Skills
objects rather than referencing local paths.

Run once from agent/agent-configs/:
    python3 upload_skills.py
"""
import re
from pathlib import Path

import anthropic
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE.parent / ".env.local")

# Where Claude Code stores locally-installed marketplace plugins on THIS
# machine. This is read-only source material for the upload below — it's
# never modified, and living outside this git repo, it isn't something a
# teammate on a different machine would already have on disk.
PLUGIN_SKILLS_DIR = Path.home() / ".claude/plugins/marketplaces/fabric-collection/skills"

# The four reference guides we're adopting. (A fifth Microsoft skill,
# powerbi-report-management, covers publishing reports to a live Fabric
# workspace via API — deliberately excluded, since this pipeline never
# publishes anywhere; it only produces files for a human to build locally.)
TARGET_SKILLS = [
    "powerbi-report-design",
    "powerbi-report-planning",
    "semantic-model-authoring",
    "powerbi-report-authoring",
]

# The exact "Update Check" text block, reproduced here so we can find-and-
# remove it verbatim from every skill's main file (each one had an identical
# copy of this notice).
UPDATE_CHECK_BLOCK = """> **Update Check — ONCE PER SESSION (mandatory)**
> The first time this skill is used in a session, run the **check-updates** skill before proceeding.
> - **GitHub Copilot CLI / VS Code**: invoke the `check-updates` skill.
> - **Claude Code / Cowork / Cursor / Windsurf / Codex**: compare local vs remote package.json version.
> - Skip if the check was already performed earlier in this session.

"""

# CRITICAL NOTES block is Fabric-workspace-listing guidance (relevant to
# powerbi-report-management, which we're not attaching) -- misplaced/irrelevant noise
# for a pure IR-authoring reviewer with no Fabric API access.
CRITICAL_NOTES_BLOCK_RE = re.compile(
    r"> \*\*CRITICAL NOTES\*\*\n(?:> .*\n)+\n?", re.MULTILINE
)

# Sections to strip from powerbi-report-authoring specifically -- each is (start
# heading, next heading) so the removal is precise regardless of exact line numbers.
AUTHORING_SECTION_CUTS = [
    ("## CLI Setup", "## PBIR File Layout"),
    ("## Authoring Metadata & Validation CLI", "## Visual Capability Guardrails"),
    ("## Edit → Validate → Reload → Screenshot Loop", "---\n\n## Validation"),
    ("## Validation\n", "---\n\n## Anti-Patterns and Pitfalls"),
]


def strip_section(text: str, start_heading: str, next_heading: str) -> str:
    """Deletes everything from `start_heading` up to (but not including)
    `next_heading`. Using two markdown headings as the "cut points" (rather
    than, say, line numbers) means this keeps working even if unrelated
    edits shift line numbers elsewhere in the file."""
    start = text.find(start_heading)
    if start == -1:
        raise ValueError(f"section not found (already stripped or SKILL.md changed?): {start_heading!r}")
    end = text.find(next_heading, start)
    if end == -1:
        raise ValueError(f"end marker not found: {next_heading!r}")
    return text[:start] + text[end:]


def clean_skill_md(text: str, skill_name: str) -> str:
    """Applies both stripping rules above to one skill's main guide file:
    remove the always-irrelevant "Update Check" notice from every skill, and
    (only for powerbi-report-authoring) also remove the CLI/Desktop-specific
    sections this agent can never act on."""
    text = text.replace(UPDATE_CHECK_BLOCK, "")
    text = CRITICAL_NOTES_BLOCK_RE.sub("", text)
    if skill_name == "powerbi-report-authoring":
        for start_heading, next_heading in AUTHORING_SECTION_CUTS:
            text = strip_section(text, start_heading, next_heading)
    return text


def collect_files(skill_name: str) -> list[tuple[str, bytes]]:
    """Walks every file inside one skill's folder (its main guide plus any
    supporting reference files/examples) and prepares them for upload. Only
    the main guide file gets text-cleaned; everything else (reference docs,
    example JSON, etc.) is uploaded byte-for-byte unchanged."""
    skill_dir = PLUGIN_SKILLS_DIR / skill_name
    if not skill_dir.is_dir():
        raise FileNotFoundError(f"skill directory not found: {skill_dir}")

    files: list[tuple[str, bytes]] = []
    for path in sorted(skill_dir.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(skill_dir)
        # Upload path must keep the skill name as the shared top-level directory
        # (API requirement: all files in one top-level dir, SKILL.md at its root).
        upload_path = f"{skill_name}/{rel.as_posix()}"
        if rel.as_posix() == "SKILL.md":
            content = clean_skill_md(path.read_text(), skill_name).encode()
        else:
            content = path.read_bytes()
        files.append((upload_path, content))
    return files


def main() -> None:
    client = anthropic.Anthropic()
    results = {}

    # One `skills.create()` call per guide: this is the actual "publish this
    # reference material to Anthropic's platform" step. It returns a
    # permanent `skill_id`, which is what gets handed to individual agents
    # later (see apply_skills.py) to say "you may consult this."
    for skill_name in TARGET_SKILLS:
        files = collect_files(skill_name)
        print(f"{skill_name}: {len(files)} files, uploading...")
        skill = client.beta.skills.create(
            display_title=skill_name,
            files=[(path, content) for path, content in files],
        )
        results[skill_name] = skill
        print(f"  -> skill_id={skill.id} version={skill.latest_version}")

    print()
    print("=== Summary (paste into apply_skills.py) ===")
    for skill_name, skill in results.items():
        print(f'{skill_name.upper().replace("-", "_")}_SKILL_ID = "{skill.id}"')


if __name__ == "__main__":
    main()
