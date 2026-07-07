"""
WHAT THIS SCRIPT IS, IN BUSINESS TERMS
---------------------------------------
This is the "day one" bootstrap script for the whole multi-agent pipeline.
Before this script ever ran, there was a single AI agent (the "coordinator")
that talked to the user directly and did everything itself. This script is
what turned that single agent into a small *team*: it hires three new
specialist agents (bi-planner, bi-design, bi-authoring — see the org-chart
analogy below) and promotes the original agent into a manager role that
delegates to them.

You run this exactly once, when standing the team up for the first time.
After that, the team exists permanently as configuration on Anthropic's
platform — this script is historical record of how it was built, not
something that runs again in production.

CONCEPT: The "coordinator + subagents" pattern (multi-agent orchestration)
---------------------------------------------------------------------------
Think of it like an org chart:
  - The COORDINATOR is a project manager. It talks to the human client,
    breaks the work into stages, and hands each stage to the right
    specialist — but doesn't do the specialist work itself anymore.
  - bi-planner is a business analyst: turns a raw data schema + business
    ask into a written, human-reviewable spec.
  - bi-design is the report designer: writes the actual dashboard layout and
    the underlying data-model definition (DAX measures, etc).
  - bi-authoring is the QA reviewer: runs the design through real validation
    rules and either signs off or sends specific, quotable feedback back.

This is a deliberate alternative to "one giant agent with a giant prompt
that tries to do everything." Splitting the work has two business
advantages: (1) each specialist can use a cheaper or more expensive AI model
depending on how hard its job is (see bi-authoring.agent.yaml using the more
capable/expensive model for QA, while bi-planner uses a cheaper one for
drafting), and (2) each one gets a focused, shorter set of instructions
instead of one document trying to cover every stage at once — same reason a
company hires specialists instead of one person who does everything.

CONCEPT: How the platform wires a coordinator to its subagents
------------------------------------------------------------------
An Agent config has a `multiagent` field. When it's set to
`{"type": "coordinator", "agents": [id1, id2, id3]}`, the platform allows
that agent, mid-conversation, to spin up a private sub-conversation
("thread") with any agent in that list and exchange messages with it — like
a manager stepping into a specialist's office, handing them a task, and
waiting for the result before returning to the client. The human never sees
those internal conversations directly; the coordinator relays only what's
useful.

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
    """Each `*.agent.yaml` file in this folder is a human-editable "job
    description" — model choice, system prompt, tools. This just reads one
    off disk and parses it into the dict shape `agents.create()` expects."""
    text = (HERE / filename).read_text()
    return yaml.safe_load(text)


def main() -> None:
    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from env

    # 1. Create the three subagents.
    #    Each `agents.create()` call "hires" one specialist: it registers a
    #    new, permanent Agent object on Anthropic's platform and returns its
    #    ID (a stable handle we'll need in step 3 to introduce them to the
    #    coordinator). Nothing about this touches the live chat app yet.
    subagent_ids: dict[str, str] = {}
    for filename in ("bi-planner.agent.yaml", "bi-design.agent.yaml", "bi-authoring.agent.yaml"):
        config = load_config(filename)
        agent = client.beta.agents.create(**config)
        subagent_ids[config["name"]] = agent.id
        print(f"  created {config['name']}: {agent.id} (version {agent.version})")

    # 2. Find the existing coordinator via the reference session.
    #    We don't hardcode the coordinator's agent ID here; instead we look up
    #    a known, already-running session and ask "which agent is this
    #    session built on?" — that's a robust way to find "the current
    #    coordinator" without needing to remember its ID separately.
    session_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SESSION_ID
    session = client.beta.sessions.retrieve(session_id)
    coordinator_id = session.agent.id
    coordinator = client.beta.agents.retrieve(coordinator_id)
    print(f"\n  coordinator: {coordinator_id} (current version {coordinator.version})")

    # 3. Update the coordinator: add the multiagent roster + new system prompt.
    #    This is the step that actually turns "one do-everything agent" into
    #    "a manager with a team." `multiagent.agents` is the coordinator's
    #    roster — the list of specialists it's now allowed to delegate to.
    #    Its system prompt is also swapped for one written for a manager's
    #    job (relay work, don't do it) rather than a do-everything worker's.
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
