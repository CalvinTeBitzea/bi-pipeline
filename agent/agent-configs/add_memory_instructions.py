"""
One-time setup: append memory-store usage instructions to bi-design's and
bi-authoring's existing system prompts (fetched live, not hardcoded, so this
doesn't clobber anything else already in them).

Run once from agent/agent-configs/:
    python3 add_memory_instructions.py
"""
from pathlib import Path

import anthropic
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE.parent / ".env.local")

BI_DESIGN_ID    = "agent_01Auw9HmVhn71m97DEwPGkui"
BI_AUTHORING_ID = "agent_014pXjcphcdvysd5PQKhyBBf"

DESIGN_ADDENDUM = """

## Memory

Before generating dashboard_spec.json/semantic_model.json, check
/mnt/memory/bi-pipeline-lessons/ for entries relevant to the visual types or
DAX patterns you're about to use, and apply them.
"""

AUTHORING_ADDENDUM = """

## Memory

When validate_ir reports a failure that isn't a trivial fix (took a real
revision round, not just a typo), write a short lesson to
/mnt/memory/bi-pipeline-lessons/ before finishing: what went wrong, why, and
how it was fixed. One file per distinct lesson, named for the pattern (e.g.
missing-required-fields.md). If a similar lesson already exists, update it
rather than creating a duplicate.
"""


def append_and_update(agent_id: str, addendum: str) -> None:
    client = anthropic.Anthropic()
    agent = client.beta.agents.retrieve(agent_id)
    if "## Memory" in (agent.system or ""):
        print(f"  {agent.name}: already has a Memory section, skipping")
        return
    new_system = (agent.system or "") + addendum
    updated = client.beta.agents.update(agent_id, version=agent.version, system=new_system)
    print(f"  {agent.name}: updated -> version {updated.version}")


def main() -> None:
    append_and_update(BI_DESIGN_ID, DESIGN_ADDENDUM)
    append_and_update(BI_AUTHORING_ID, AUTHORING_ADDENDUM)


if __name__ == "__main__":
    main()
