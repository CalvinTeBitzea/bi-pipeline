"""
WHAT THIS SCRIPT IS, IN BUSINESS TERMS
---------------------------------------
upload_skills.py published Microsoft's reference guides onto Anthropic's
platform as standalone "Skill" objects — but publishing them doesn't hand
them to anyone yet. This script is the second half: it says "bi-planner may
consult THIS guide, bi-design may consult THESE two, bi-authoring may
consult THOSE two" — i.e. it assigns reference material to specific
employees based on their actual job, the same way you wouldn't hand a
graphic-design style guide to your accountant.

CONCEPT: Assigning a skill vs. writing it into the prompt
------------------------------------------------------------
Attaching a skill to an agent is a completely separate action from editing
its system prompt (see add_skill_instructions.py, which is the follow-up
step that actually *tells* the agent these are there and when to use them).
Attaching is a config-level "you're allowed to open this book"; the prompt
addendum is "and here's when you should bother." Both matter — attaching
without prompting means the material is technically available but the agent
may not think to look; prompting without attaching would just be
instructing the agent to open a book it doesn't have.

By role:
  bi-planner   -> powerbi-report-planning
  bi-design    -> powerbi-report-design, semantic-model-authoring
  bi-authoring -> powerbi-report-authoring (adapted, reference-only), semantic-model-authoring

CONCEPT: Referencing by ID only, not ID+version ("unpinned")
------------------------------------------------------------------
Every skill upload gets its own version number too (just like an Agent
config — see apply.py). This script attaches skills by `skill_id` ALONE,
deliberately leaving the version unspecified, so the platform always
resolves it to "whatever the latest version of this skill is" at the moment
each agent conversation starts. This means re-running upload_skills.py after
Microsoft updates their guides, and republishing a new skill version, takes
effect automatically — no need to re-run this attachment script. (This
mirrors a similar, real bug found earlier in this project: the coordinator's
list of subagents had been pinned to specific *agent* versions instead of
bare IDs, which silently meant config fixes to those subagents were never
actually being picked up. Unpinning here avoids repeating that mistake for
skills.)

Run once from agent/agent-configs/, after upload_skills.py:
    python3 apply_skills.py
"""
from pathlib import Path

import anthropic
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE.parent / ".env.local")

BI_PLANNER_ID   = "agent_016bjEDxxuKfgpR1kgyGeVij"
BI_DESIGN_ID    = "agent_01Auw9HmVhn71m97DEwPGkui"
BI_AUTHORING_ID = "agent_014pXjcphcdvysd5PQKhyBBf"

# These IDs came out of upload_skills.py's printed summary — copied here by
# hand as the "handoff" between the two scripts.
POWERBI_REPORT_DESIGN_SKILL_ID    = "skill_01D6EyQUSg8V9WoGUezs6oXd"
POWERBI_REPORT_PLANNING_SKILL_ID  = "skill_018oWxEVCukviXvp7JzMtsDK"
SEMANTIC_MODEL_AUTHORING_SKILL_ID = "skill_017YJtYoSjCSFVZfBZPKcmwY"
POWERBI_REPORT_AUTHORING_SKILL_ID = "skill_015CzYdMnd4jhVFWNnkjPNsU"

# The actual "who gets which reference books" assignment table.
ASSIGNMENTS = {
    BI_PLANNER_ID:   ("bi-planner",   [POWERBI_REPORT_PLANNING_SKILL_ID]),
    BI_DESIGN_ID:    ("bi-design",    [POWERBI_REPORT_DESIGN_SKILL_ID, SEMANTIC_MODEL_AUTHORING_SKILL_ID]),
    BI_AUTHORING_ID: ("bi-authoring", [POWERBI_REPORT_AUTHORING_SKILL_ID, SEMANTIC_MODEL_AUTHORING_SKILL_ID]),
}


def apply_and_verify(client: anthropic.Anthropic, agent_id: str, label: str, skill_ids: list[str]) -> None:
    """Attach the given skills to one agent, publishing a new agent version
    (same "config change = new version" model as every other update in this
    folder) — then immediately fetch the agent back and print what actually
    got resolved. Trusting the response from the `update` call alone isn't
    enough discipline for infrastructure you don't own the internals of;
    reading it back closes the loop and catches silent mismatches early."""
    agent = client.beta.agents.retrieve(agent_id)
    updated = client.beta.agents.update(
        agent_id,
        version=agent.version,
        skills=[{"type": "custom", "skill_id": sid} for sid in skill_ids],
    )
    print(f"{label}: v{agent.version} -> v{updated.version}")

    resolved = client.beta.agents.retrieve(agent_id)
    resolved_ids = [s.skill_id for s in resolved.skills]
    print(f"  resolved skills: {resolved_ids}")
    missing = set(skill_ids) - set(resolved_ids)
    if missing:
        print(f"  WARNING: expected skill_ids not present after update: {missing}")


def main() -> None:
    client = anthropic.Anthropic()
    for agent_id, (label, skill_ids) in ASSIGNMENTS.items():
        apply_and_verify(client, agent_id, label, skill_ids)


if __name__ == "__main__":
    main()
