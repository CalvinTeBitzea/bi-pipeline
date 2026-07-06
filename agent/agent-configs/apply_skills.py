"""
One-time setup: attach the uploaded Microsoft skills-for-fabric skills (see
upload_skills.py) to the 3 pipeline subagents, by role:
  bi-planner   -> powerbi-report-planning
  bi-design    -> powerbi-report-design, semantic-model-authoring
  bi-authoring -> powerbi-report-authoring (adapted, reference-only), semantic-model-authoring

Skills referenced by skill_id alone (no version pin) so future re-uploads (e.g. after
running upload_skills.py again against an updated marketplace checkout) take effect
automatically -- same reasoning as unpinning the coordinator's subagent roster earlier
this session.

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

POWERBI_REPORT_DESIGN_SKILL_ID    = "skill_01D6EyQUSg8V9WoGUezs6oXd"
POWERBI_REPORT_PLANNING_SKILL_ID  = "skill_018oWxEVCukviXvp7JzMtsDK"
SEMANTIC_MODEL_AUTHORING_SKILL_ID = "skill_017YJtYoSjCSFVZfBZPKcmwY"
POWERBI_REPORT_AUTHORING_SKILL_ID = "skill_015CzYdMnd4jhVFWNnkjPNsU"

ASSIGNMENTS = {
    BI_PLANNER_ID:   ("bi-planner",   [POWERBI_REPORT_PLANNING_SKILL_ID]),
    BI_DESIGN_ID:    ("bi-design",    [POWERBI_REPORT_DESIGN_SKILL_ID, SEMANTIC_MODEL_AUTHORING_SKILL_ID]),
    BI_AUTHORING_ID: ("bi-authoring", [POWERBI_REPORT_AUTHORING_SKILL_ID, SEMANTIC_MODEL_AUTHORING_SKILL_ID]),
}


def apply_and_verify(client: anthropic.Anthropic, agent_id: str, label: str, skill_ids: list[str]) -> None:
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
