"""
WHAT THIS SCRIPT IS, IN BUSINESS TERMS
---------------------------------------
This is a follow-up fix to apply_skills.py. After attaching the Microsoft
reference guides to bi-design/bi-authoring, a live test showed something
important and slightly counter-intuitive: just because an agent CAN open a
reference file doesn't mean it reliably WILL, especially on a task it's
already confident about. In this test, bi-planner (which had never handled
this kind of request before) read its guide unprompted, on its very first
move — proof the underlying mechanism genuinely works. But bi-design and
bi-authoring, working a familiar, well-worn test scenario already well
covered by the memory-lessons folder and the house style brief, skipped
their guides entirely.

The fix mirrors a lesson already learned once in this project (see the
memory-store work, and add_memory_instructions.py): giving an agent access
to something isn't the same as it reliably remembering to use that access at
the right moment — an explicit, direct pointer in the instructions closes
that gap. This script adds that pointer.

CONCEPT: "Automatic" tool/skill usage is a tendency, not a guarantee
------------------------------------------------------------------------
Foundation models decide for themselves, at each step, whether a given tool
or reference is worth consulting for the task in front of them — there's no
hard rule forcing it. That's usually a feature (it keeps the agent from
wastefully reading every reference file on every trivial task), but it means
that for cases where you specifically want a resource consulted every time
— e.g. a compliance checklist, a style guide, or, here, a design-quality
review step — you often need to say so explicitly rather than relying on
the model's own judgment of relevance. This is a very common pattern when
building on top of LLMs: capability != reliability, and closing that gap
usually means writing it into the instructions rather than assuming it.

Idempotent: checks for an existing "## Skills" section before appending
(same discipline as add_memory_instructions.py, so this script is safe to
re-run without appending duplicate sections).

Run once from agent/agent-configs/:
    python3 add_skill_instructions.py
"""
from pathlib import Path

import anthropic
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE.parent / ".env.local")

BI_DESIGN_ID    = "agent_01Auw9HmVhn71m97DEwPGkui"
BI_AUTHORING_ID = "agent_014pXjcphcdvysd5PQKhyBBf"

# The addendum tells bi-design not just THAT the reference guides exist, but
# WHEN to reach for them (before writing the output files, not after) and
# HOW to use them efficiently (follow the guide's own "which page do I need"
# routing table, rather than reading everything cover to cover every time —
# the same progressive-disclosure idea explained in upload_skills.py).
DESIGN_ADDENDUM = """

## Skills

You have two reference skills mounted at /workspace/skills/ --
`powerbi-report-design` and `semantic-model-authoring`. Read their SKILL.md
files (e.g. /workspace/skills/powerbi-report-design/SKILL.md) before writing
dashboard_spec.json/semantic_model.json, not just on complex reports -- they
cover chart-selection rationale, layout/composition patterns, color and
typography conventions, accessibility, and DAX/TMDL modeling guidelines in
more depth than the house design brief above states outright. Follow their
topic-file routing tables to pull in the specific reference file for the
decision at hand (e.g. chart-selection.md before picking a visual type,
dax-guidelines.md before writing a measure) rather than reading everything
up front.
"""

# bi-authoring's version ties the same instruction to its specific job
# (quality review, step 4 of its process) and explicitly warns off the one
# thing that would go wrong if it tried to follow the (already-stripped) CLI
# instructions some of this reference material's SOURCE files still describe
# elsewhere — see upload_skills.py for why those sections were removed.
AUTHORING_ADDENDUM = """

## Skills

You have two reference skills mounted at /workspace/skills/ --
`powerbi-report-authoring` and `semantic-model-authoring`. As part of your
step-4 design-brief compliance check, read their SKILL.md files (e.g.
/workspace/skills/powerbi-report-authoring/SKILL.md) and check the design
stage's output against their anti-patterns tables, the "prefer modern visual
types" guardrails, and the DAX/TMDL modeling conventions -- these catch
issues beyond the automated validate_ir gate and the design brief's own
stated rules. These are reference material only: you have no CLI/bash tool,
so don't attempt to run any command mentioned in them (e.g.
`powerbi-report-author validate`) -- read them for the conventions, not the
tooling instructions.
"""


def append_and_update(client: anthropic.Anthropic, agent_id: str, addendum: str) -> None:
    agent = client.beta.agents.retrieve(agent_id)
    if "## Skills" in (agent.system or ""):
        print(f"  {agent.name}: already has a Skills section, skipping")
        return
    new_system = (agent.system or "") + addendum
    updated = client.beta.agents.update(agent_id, version=agent.version, system=new_system)
    print(f"  {agent.name}: updated -> version {updated.version}")


def main() -> None:
    client = anthropic.Anthropic()
    append_and_update(client, BI_DESIGN_ID, DESIGN_ADDENDUM)
    append_and_update(client, BI_AUTHORING_ID, AUTHORING_ADDENDUM)


if __name__ == "__main__":
    main()
