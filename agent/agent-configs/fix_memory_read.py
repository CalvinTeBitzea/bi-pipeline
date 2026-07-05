"""
Fix Phase B memory read failure: run 2 proved bi-design/bi-authoring can't
discover existing lesson files (no glob/grep tool -> can only guess filenames,
guessed wrong, wrote a 3rd overlapping lesson instead of finding the other two).

This script:
  1. Gives both agents glob + grep (bi-authoring currently has NO explicit
     agent_toolset block at all -- it relies on an undocumented implicit
     baseline of read/write/edit, so its new block must include those too,
     not just add glob/grep, or the update would silently narrow its tools).
  2. Replaces the existing narrow "## Memory" section (scoped to "visual
     types or DAX patterns") with instructions to glob-list then grep-search
     for ANY relevant lesson, and (for bi-authoring) dedup before writing.
  3. Verifies the resolved tool list via agents.retrieve after each update.

Run once from agent/agent-configs/:
    python3 fix_memory_read.py
"""
from pathlib import Path

import anthropic
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE.parent / ".env.local")

BI_DESIGN_ID    = "agent_01Auw9HmVhn71m97DEwPGkui"
BI_AUTHORING_ID = "agent_014pXjcphcdvysd5PQKhyBBf"

DESIGN_MEMORY = """

## Memory

Before generating dashboard_spec.json/semantic_model.json, use the `glob`
tool to list every file under /mnt/memory/bi-pipeline-lessons/ (e.g.
`/mnt/memory/bi-pipeline-lessons/*.md`) -- do not guess filenames, list them.
Then use `grep` to search those files for keywords relevant to what you're
about to write (schema field names, visual types, DAX patterns, "required",
"schema", etc.) and read any file that matches. This covers ALL mistake
categories, not just visual-type or DAX-pattern ones -- required top-level
fields (model_id, spec_id), IR shape, and schema-validation gotchas are just
as likely to be documented there and just as important to check. Apply
anything relevant before writing your files.
"""

AUTHORING_MEMORY = """

## Memory

When validate_ir reports a failure that isn't a trivial fix (took a real
revision round, not just a typo), write a short lesson to
/mnt/memory/bi-pipeline-lessons/ before finishing: what went wrong, why, and
how it was fixed.

Before creating a new file: use `glob` to list every file already in
/mnt/memory/bi-pipeline-lessons/, then `grep` across them for keywords
related to the mistake you're about to document. If a similar lesson
already exists, use `write` to overwrite it with the updated/merged content
-- do not create a second overlapping file for the same mistake category.
Only create a new file when the mistake is genuinely not covered by
anything already there. One file per distinct lesson, named for the
pattern (e.g. missing-required-fields.md).
"""

DESIGN_TOOLS = {
    "type": "agent_toolset_20260401",
    "default_config": {"enabled": False},
    "configs": [
        {"name": "write", "enabled": True},
        {"name": "edit",  "enabled": True},
        {"name": "read",  "enabled": True},
        {"name": "glob",  "enabled": True},
        {"name": "grep",  "enabled": True},
    ],
}

# bi-authoring currently has NO agent_toolset block (only the custom
# validate_ir tool) and still reads/writes files today -- so it must be
# getting an implicit read/write/edit baseline. Include all three explicitly
# alongside glob/grep so this update can't accidentally narrow that baseline.
AUTHORING_TOOLS = {
    "type": "agent_toolset_20260401",
    "default_config": {"enabled": False},
    "configs": [
        {"name": "read",  "enabled": True},
        {"name": "write", "enabled": True},
        {"name": "edit",  "enabled": True},
        {"name": "glob",  "enabled": True},
        {"name": "grep",  "enabled": True},
    ],
}

VALIDATE_IR_TOOL = {
    "type": "custom",
    "name": "validate_ir",
    "description": (
        "Validate dashboard_spec.json and semantic_model.json against the real "
        "build gates (schema, cross-references, IR fidelity). Call this on "
        "every file the design stage produces, before reporting pass/fail."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "dashboard_spec": {"type": "object"},
            "semantic_model": {"type": "object"},
        },
        "required": ["dashboard_spec", "semantic_model"],
    },
}


def replace_memory_section(system: str, new_section: str) -> str:
    marker = "\n\n## Memory\n"
    idx = system.find(marker)
    base = system[:idx] if idx != -1 else system.rstrip()
    return base + new_section


def update(client, agent_id, new_tools, new_memory_section, label):
    agent = client.beta.agents.retrieve(agent_id)
    new_system = replace_memory_section(agent.system or "", new_memory_section)
    updated = client.beta.agents.update(
        agent_id,
        version=agent.version,
        system=new_system,
        tools=new_tools,
    )
    print(f"  {label}: v{agent.version} -> v{updated.version}")

    # Verify the resolved tool list actually matches intent before trusting it.
    resolved = client.beta.agents.retrieve(agent_id)
    for t in resolved.tools:
        if getattr(t, "type", None) == "agent_toolset_20260401":
            names = sorted(c.name for c in t.configs if c.enabled)
            print(f"    resolved enabled tools: {names}")
        else:
            print(f"    resolved tool: {getattr(t, 'name', t.type)}")


def main() -> None:
    client = anthropic.Anthropic()
    update(client, BI_DESIGN_ID, [DESIGN_TOOLS], DESIGN_MEMORY, "bi-design")
    update(client, BI_AUTHORING_ID, [AUTHORING_TOOLS, VALIDATE_IR_TOOL], AUTHORING_MEMORY, "bi-authoring")


if __name__ == "__main__":
    main()
