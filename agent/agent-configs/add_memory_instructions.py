"""
WHAT THIS SCRIPT IS, IN BUSINESS TERMS
---------------------------------------
This is a one-time "configuration patch" script. It does not run as part of
the live product — nobody using the chat app triggers this. It's a script I
(the developer) run once from my own terminal to change how two of the AI
agents in the pipeline behave, permanently, going forward.

What it changes: it teaches `bi-design` and `bi-authoring` (two of the AI
"employees" in this pipeline — see the business-terms note on agents below)
to check a shared "lessons learned" folder before doing their work, so the
pipeline gets smarter over time instead of repeating the same mistakes on
every customer's report.

CONCEPT: What is an "agent" here, technically?
-----------------------------------------------
In Anthropic's Managed Agents API, an "Agent" is a stored, versioned
configuration object — think of it like a job description on file, not a
live worker. It bundles: a system prompt (the standing instructions/"job
description"), a model choice (which underlying AI model runs the job), and
a tool list (what actions it's allowed to take — read files, write files,
call a validation function, etc). When a real customer conversation happens,
the platform spins up a live "session" that follows whichever Agent version
was in effect when that session was created.

Every time you call `agents.update(...)`, you are NOT editing the job
description in place — you're publishing a brand new, immutable version of
it (version 1, 2, 3, ...). Old sessions keep running against whatever
version they started with; only *new* sessions pick up the latest version.
This script's job is to publish new versions of bi-design and bi-authoring
with an added "## Memory" instruction block appended to their system
prompts.

CONCEPT: Why "append", not "replace"?
--------------------------------------
`agent.system` here is fetched live from the platform (not hardcoded in this
file) before appending. That protects against accidentally deleting whatever
else is already in the prompt (the actual job instructions) — this script
only ever adds a new section at the end, and only if that section doesn't
already exist (see the `if "## Memory" in ...` guard below), so it's safe to
re-run without duplicating the block.

Run once from agent/agent-configs/:
    python3 add_memory_instructions.py
"""
from pathlib import Path

import anthropic
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE.parent / ".env.local")  # loads ANTHROPIC_API_KEY from a local secrets file

# These IDs point at the specific, already-created Agent objects we're patching.
# (Agent IDs are permanent — they identify "the bi-design job", across every
# version it's ever had — a version number is layered on top of this ID.)
BI_DESIGN_ID    = "agent_01Auw9HmVhn71m97DEwPGkui"
BI_AUTHORING_ID = "agent_014pXjcphcdvysd5PQKhyBBf"

# The actual instruction text that gets bolted onto each agent's system prompt.
# In business terms: this is new "standard operating procedure" wording added
# to that employee's job description. bi-design is told to *read* the lessons
# folder before working; bi-authoring (which catches mistakes via validation)
# is told to *write* a new lesson whenever it catches something non-trivial.
# Together, this creates a feedback loop: authoring's catches become design's
# future guardrails.
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
    """Fetch the agent's CURRENT live config, tack the addendum onto its
    system prompt, and publish that as a new version. Idempotent: if the
    "## Memory" heading is already present (e.g. this script ran before),
    it does nothing rather than appending a second copy."""
    client = anthropic.Anthropic()
    agent = client.beta.agents.retrieve(agent_id)  # "job description as currently filed" — always live, never cached
    if "## Memory" in (agent.system or ""):
        print(f"  {agent.name}: already has a Memory section, skipping")
        return
    new_system = (agent.system or "") + addendum
    # This call publishes a new version. `version=agent.version` tells the API
    # "I'm updating from what I believe is the current version" — a safety
    # check against two people/scripts overwriting each other's changes blind.
    updated = client.beta.agents.update(agent_id, version=agent.version, system=new_system)
    print(f"  {agent.name}: updated -> version {updated.version}")


def main() -> None:
    append_and_update(BI_DESIGN_ID, DESIGN_ADDENDUM)
    append_and_update(BI_AUTHORING_ID, AUTHORING_ADDENDUM)


if __name__ == "__main__":
    main()
