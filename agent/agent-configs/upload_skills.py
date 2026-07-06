"""
One-time setup: package Microsoft's skills-for-fabric skills (installed locally as a
Claude Code plugin) and upload them as Managed Agents custom Skills, so bi-planner/
bi-design/bi-authoring can consult the real guidance content live, at runtime,
regardless of which machine is running the chat UI.

Source: Claude Code plugin cache for the "fabric-collection" marketplace
(https://github.com/microsoft/skills-for-fabric.git), NOT this repo — these files are
local to this machine, hence packaging + uploading them as first-class Anthropic Skills
objects rather than referencing local paths.

Strips two things before upload:
  1. The "Update Check — ONCE PER SESSION" header block present verbatim in every
     skill's SKILL.md — instructs an interactive coding agent (Claude Code/Cursor/etc)
     to check for marketplace updates; meaningless for a headless production agent.
  2. For powerbi-report-authoring ONLY: the CLI Setup, Authoring Metadata & Validation
     CLI, Edit->Validate->Reload->Screenshot Loop, and standalone Validation sections —
     all of these instruct the agent to invoke `powerbi-report-author`/`powerbi-desktop`
     CLIs via bash. bi-authoring has no bash tool, and `powerbi-desktop` specifically
     remote-controls a live Windows Power BI Desktop GUI process over a local IPC
     bridge — it cannot function in a cloud container regardless of packaging. Real
     PBIR validation already happens in builder/'s deterministic pipeline (Gate 1b
     already calls the real CLI there). Keep everything else — the reference docs are
     useful even though these agents never touch real PBIR directly.

Run once from agent/agent-configs/:
    python3 upload_skills.py
"""
import re
from pathlib import Path

import anthropic
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE.parent / ".env.local")

PLUGIN_SKILLS_DIR = Path.home() / ".claude/plugins/marketplaces/fabric-collection/skills"

TARGET_SKILLS = [
    "powerbi-report-design",
    "powerbi-report-planning",
    "semantic-model-authoring",
    "powerbi-report-authoring",
]

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
    start = text.find(start_heading)
    if start == -1:
        raise ValueError(f"section not found (already stripped or SKILL.md changed?): {start_heading!r}")
    end = text.find(next_heading, start)
    if end == -1:
        raise ValueError(f"end marker not found: {next_heading!r}")
    return text[:start] + text[end:]


def clean_skill_md(text: str, skill_name: str) -> str:
    text = text.replace(UPDATE_CHECK_BLOCK, "")
    text = CRITICAL_NOTES_BLOCK_RE.sub("", text)
    if skill_name == "powerbi-report-authoring":
        for start_heading, next_heading in AUTHORING_SECTION_CUTS:
            text = strip_section(text, start_heading, next_heading)
    return text


def collect_files(skill_name: str) -> list[tuple[str, bytes]]:
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
