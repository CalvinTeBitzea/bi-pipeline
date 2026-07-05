"""
One-time setup script: creates bi-planner, bi-design, bi-authoring as real
Managed Agents, then updates the existing coordinator (identified via the
reference session) with the multiagent roster + new orchestration-only
system prompt.

Run once from agent/agent-configs/:
    python3 apply.py

Reads ANTHROPIC_API_KEY from agent/.env.local (via python-dotenv) — never
prints it. Safe to re-run for the three `create` calls only if you delete
the printed IDs and want fresh agents; re-running the coordinator `update`
bumps its version again (each update is a new immutable version, so nothing
is lost by re-running).
"""
from __future__ import annotations

import sys
from pathlib import Path

import anthropic
import yaml
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE.parent / ".env.local")

DEFAULT_SESSION_ID = "sesn_01S3zW6pLxWnwyxZ9rmB6tZB"  # same fallback as chat/route.js


def load_config(filename: str) -> dict:
    text = (HERE / filename).read_text()
    return yaml.safe_load(text)


def main() -> None:
    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from env

    # 1. Create the three subagents.
    subagent_ids: dict[str, str] = {}
    for filename in ("bi-planner.agent.yaml", "bi-design.agent.yaml", "bi-authoring.agent.yaml"):
        config = load_config(filename)
        agent = client.beta.agents.create(**config)
        subagent_ids[config["name"]] = agent.id
        print(f"  created {config['name']}: {agent.id} (version {agent.version})")

    # 2. Find the existing coordinator via the reference session.
    session_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SESSION_ID
    session = client.beta.sessions.retrieve(session_id)
    coordinator_id = session.agent.id
    coordinator = client.beta.agents.retrieve(coordinator_id)
    print(f"\n  coordinator: {coordinator_id} (current version {coordinator.version})")

    # 3. Update the coordinator: add the multiagent roster + new system prompt.
    update_config = load_config("bi-coordinator-update.agent.yaml")
    multiagent = {
        "type": "coordinator",
        "agents": [
            subagent_ids["bi-planner"],
            subagent_ids["bi-design"],
            subagent_ids["bi-authoring"],
        ],
    }
    updated = client.beta.agents.update(
        coordinator_id,
        version=coordinator.version,
        multiagent=multiagent,
        system=update_config["system"],
    )
    print(f"  updated coordinator -> version {updated.version}")
    print("\nDone. New sessions created against this coordinator will use the")
    print("planner -> design -> authoring roster. Existing sessions keep running")
    print("on their prior pinned version.")


if __name__ == "__main__":
    main()
