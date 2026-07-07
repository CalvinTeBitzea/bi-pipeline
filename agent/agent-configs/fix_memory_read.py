"""
WHAT THIS SCRIPT IS, IN BUSINESS TERMS
---------------------------------------
This is a bug-fix script, kept here as a record of a real incident and how it
was diagnosed and fixed. The story: after add_memory_instructions.py taught
bi-design/bi-authoring to consult a shared "lessons learned" folder, a live
test run showed they *still* repeated the same mistakes. Telling an employee
"go check the shared drive for past mistakes" doesn't help if they don't
have the equivalent of a file browser or search bar — they'd have to guess
the exact filename, which they got wrong. This script gives them that
"file browser + search" capability and rewrites the instruction to actually
use it, rather than assuming they'll find things by luck.

CONCEPT: An AI agent can only do what its "tools" list allows
----------------------------------------------------------------
An agent's `tools` configuration isn't just documentation — it's a hard
permission boundary enforced by the platform. Telling an agent in plain
English "go search the folder" is meaningless if `glob` (list files matching
a pattern) and `grep` (search file contents for a keyword) aren't in its
tool list: it literally has no action available that does that, so at best
it can guess a filename and try to `read` it directly. This is the same
concept as a company system where an employee's badge doesn't open the
records room — no amount of telling them "go check the file" helps until
you also give them the key.

Root cause found here: bi-design/bi-authoring could `read` a file if they
already knew its exact name, but had no way to *discover* what files existed
— so a vague instruction like "check /mnt/memory/... for relevant entries"
led to guessing wrong filenames and missing real, existing lessons.

CONCEPT: "Implicit" vs. explicit tool permissions (a subtle trap)
----------------------------------------------------------------------
bi-authoring, at the time of this fix, had never been given an explicit
`agent_toolset` block — yet it clearly could already read and write files
(it does that every run). That's because leaving the toolset block out
entirely defaults to a platform-defined baseline of common tools, rather
than "no tools." That's an easy trap: the moment you add ANY explicit
toolset block to be specific about one tool (e.g. "I just want to add
glob"), you replace that implicit baseline entirely — if you forget to also
list read/write/edit explicitly, you'd silently take those away. This script
calls that out and includes all five tools explicitly for exactly that
reason (see AUTHORING_TOOLS below).

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

# Replacement "## Memory" instructions — the key change from the original
# wording is spelling out the ACTUAL SEQUENCE OF TOOL CALLS to make ("use
# glob to list, then grep to search, THEN read") instead of a vague "check
# the folder" that leaves the agent to invent its own (worse) strategy.
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

# bi-design's explicit toolset: write/edit/read (its normal job of producing
# the two output files) plus the new glob/grep pair for memory search.
DESIGN_TOOLS = {
    "type": "agent_toolset_20260401",
    "default_config": {"enabled": False},  # "start from nothing, then opt in" — an allowlist, not a blocklist
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

# bi-authoring's other tool: a CUSTOM tool (not a built-in file-system
# action). Custom tools are how you give an agent access to YOUR OWN
# business logic rather than generic file operations — here, "run the real
# validation gates and tell me pass/fail." The agent only sees this
# description + schema; the actual validation code runs on our own server
# (see agent/app/api/chat/route.js, which intercepts calls to this tool name
# and forwards them to the deployed `builder` service). This is the same
# "function calling" / "tool use" concept used across most AI agent
# platforms: the model can't execute code itself, so it asks the surrounding
# application to run a named function and hands back the result.
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
    """Cuts out everything from the OLD "## Memory" heading onward and
    replaces it with the new section -- unlike add_memory_instructions.py's
    simple append, this one assumes an older "## Memory" block already
    exists and needs to be swapped out, not added to."""
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
    # This "write, then immediately read back and check" habit matters a lot
    # when working against a remote API you don't control: it catches
    # mistakes (wrong tool name, unexpected defaults) before they cause a
    # confusing failure three steps later in a live agent run.
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
