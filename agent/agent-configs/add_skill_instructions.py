"""
Add explicit nudges pointing bi-design/bi-authoring at their attached Microsoft
skills (see upload_skills.py/apply_skills.py). Live verification showed the
"agent automatically uses skills when relevant" behavior is real (bi-planner
read its skill unprompted, first action) but didn't fire for bi-design/
bi-authoring on a well-worn repeat test brief already covered by memory + the
house design brief. Same lesson as the memory store: a mount existing isn't
always enough on its own -- an explicit instruction materially improved usage
then, so apply the same fix here.

Idempotent: checks for an existing "## Skills" section before appending.

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
