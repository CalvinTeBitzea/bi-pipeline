"""
Live verification of the coordinator -> bi-planner -> (approval pause) ->
bi-design -> bi-authoring pipeline. Creates a fresh session, sends a small
test brief+schema, prints every event type as it streams (so the multiagent
delegation and approval pause are visible), drives the validate_ir custom
tool round trip against the LIVE deployed builder, and — once the planner's
spec shows up and the session goes genuinely idle waiting for a reply —
sends an approval so the run continues through design + authoring.

Run from agent/agent-configs/:
    python3 verify_live.py
"""
import json
import sys
import urllib.request
from pathlib import Path

import anthropic
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE.parent / ".env.local")

REFERENCE_SESSION_ID = "sesn_01S3zW6pLxWnwyxZ9rmB6tZB"
BICOHOST_URL = "https://bi-cohost.vercel.app"  # deployed builder — real /api/validate call

TEST_BRIEF = """I'm providing my data model and business context for dashboard planning.

## DATA MODEL SCHEMA
fact_orders (order_id, order_date, customer_id, product_id, qty, unit_price)
dim_products (product_id, product_name, category)
dim_customers (customer_id, customer_name, region)

fact_orders.product_id -> dim_products.product_id
fact_orders.customer_id -> dim_customers.customer_id

## BUSINESS CONTEXT
Small e-commerce business. Owner wants a one-page report showing revenue by
month and by product category, plus a top-customers table.
"""


def run_validate_ir(tool_input: dict) -> tuple[str, bool]:
    body = json.dumps({
        "dashboard_spec": tool_input.get("dashboard_spec"),
        "semantic_model": tool_input.get("semantic_model"),
    }).encode()
    req = urllib.request.Request(
        f"{BICOHOST_URL}/api/validate", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read().decode(), False
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"valid": False, "error": str(exc)}), True


def main() -> None:
    client = anthropic.Anthropic()

    ref = client.beta.sessions.retrieve(REFERENCE_SESSION_ID)
    session = client.beta.sessions.create(
        agent=ref.agent.id, environment_id=ref.environment_id,
        title="verify_live smoke test",
    )
    print(f"session: {session.id}")
    print(f"trace:   https://platform.claude.com/workspaces/default/sessions/{session.id}\n")

    client.beta.sessions.events.send(session.id, events=[
        {"type": "user.message", "content": [{"type": "text", "text": TEST_BRIEF}]},
    ])

    approved = False
    with client.beta.sessions.events.stream(session.id) as stream:
        for event in stream:
            t = event.type
            if t in ("session.thread_created", "session.thread_status_running",
                      "session.thread_status_idle"):
                print(f"[{t}] agent={getattr(event, 'agent_name', '?')}")
            elif t == "agent.message":
                text = "".join(b.text for b in (event.content or []) if getattr(b, "text", None))
                print(f"[agent.message]\n{text}\n")
            elif t == "agent.custom_tool_use":
                print(f"[agent.custom_tool_use] name={event.name} thread={getattr(event, 'session_thread_id', None)}")
                if event.name == "validate_ir":
                    result_text, is_error = run_validate_ir(event.input or {})
                    print(f"  -> validate_ir result: {result_text[:300]}")
                    client.beta.sessions.events.send(session.id, events=[{
                        "type": "user.custom_tool_result",
                        "custom_tool_use_id": event.id,
                        "session_thread_id": getattr(event, "session_thread_id", None),
                        "content": [{"type": "text", "text": result_text}],
                        "is_error": is_error,
                    }])
            elif t == "session.status_idle":
                stop = getattr(event, "stop_reason", None)
                stop_type = getattr(stop, "type", None)
                print(f"[session.status_idle] stop_reason={stop_type}")
                if stop_type == "requires_action":
                    continue
                if not approved:
                    print("\n--- approving spec, sending follow-up ---\n")
                    approved = True
                    client.beta.sessions.events.send(session.id, events=[
                        {"type": "user.message", "content": [{"type": "text", "text": "Looks good, approved — go ahead."}]},
                    ])
                    continue
                print("\n=== session genuinely idle after approval — run complete ===")
                break
            elif t in ("session.error", "session.status_terminated"):
                print(f"[{t}] {event}")
                break


if __name__ == "__main__":
    main()
