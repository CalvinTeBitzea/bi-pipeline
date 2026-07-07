"""
WHAT THIS SCRIPT IS, IN BUSINESS TERMS
---------------------------------------
This is a "smoke test" — a quick way to check the whole pipeline actually
works end to end, without opening the real chat app in a browser. It plays
the role of a test customer: sends a small, realistic business brief, and
prints out everything that happens as the multi-agent team processes it, so
a developer can watch the hand-offs (planner -> human approval -> design ->
authoring) happen in real time from the terminal. This is the kind of script
you reach for constantly while building an agent pipeline, because it's much
faster than clicking through the UI every time you want to check a change
didn't break anything.

CONCEPT: Server-Sent Events (SSE) — how you "watch" a running AI agent
---------------------------------------------------------------------------
When you ask this platform to run a conversation, work doesn't happen in one
big instant response. Instead, you open a live event stream and the
platform pushes a sequence of small, typed events to you as they happen:
"a new sub-agent thread was created," "the agent said this," "the agent
wants to call this tool," "the whole conversation went idle waiting for
input," and so on. This is the same idea as a livestream instead of a
recorded video: you find out what's happening as it happens, not only at
the very end. The `with client.beta.sessions.events.stream(...) as stream:`
block below opens exactly this kind of live connection and the `for event
in stream:` loop processes each event as it arrives.

CONCEPT: Custom tools require YOU to do the work and hand back the answer
------------------------------------------------------------------------------
`validate_ir` is a "custom" tool (see fix_memory_read.py for its schema) —
unlike a built-in tool (read/write/glob/etc, which the platform executes
inside its own sandbox), a custom tool is a placeholder for OUR OWN business
logic. When the agent "calls" validate_ir, the platform doesn't run
anything itself — it emits an `agent.custom_tool_use` event and then waits.
It's on us (this script, or in production, agent/app/api/chat/route.js) to
actually run the real validation (here, by calling the live builder
service's `/api/validate` endpoint over plain HTTP) and send the result back
as a `user.custom_tool_result` event before the agent can continue. This is
the general "function calling" pattern: the model decides WHEN to call a
function and WHAT arguments to pass, but the surrounding application decides
HOW that function is actually implemented.

CONCEPT: The human-approval pause
--------------------------------------
After the planning stage produces its spec, the coordinator is designed to
stop and wait for a human "yes, proceed" before continuing to the expensive
design + authoring stages (this is a deliberate product decision — see
bi-planner's job description: it explicitly does NOT decide on approval).
In the event stream, this shows up as the session going idle with
`stop_reason.type == "requires_action"` while the FIRST time we haven't
approved yet — this script simply auto-approves after the fact to let the
test run to completion unattended, but a live user in the real chat app
would be the one making that call.

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

# A realistic, minimal test brief: a schema (two dimension tables, one fact
# table) plus a plain-English business ask, exactly the shape a real user
# would paste into the chat app.
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
    """Stands in for what the real chat app does when bi-authoring calls its
    validate_ir custom tool: forward the two IR files to the actual deployed
    validation service over HTTP and return whatever it says, verbatim.
    Returns (result_text, is_error) — is_error tells the agent whether this
    was a genuine validation verdict or a plumbing failure (e.g. the builder
    being unreachable), which matters because the agent should react very
    differently to "your file is wrong" vs. "I couldn't check your file."""
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

    # Borrow the coordinator agent + sandbox environment from an existing
    # reference session, then start a brand new, independent conversation
    # against it — this is the same "clone the reference session's config"
    # pattern used by the real app's /api/session/new route.
    ref = client.beta.sessions.retrieve(REFERENCE_SESSION_ID)
    session = client.beta.sessions.create(
        agent=ref.agent.id, environment_id=ref.environment_id,
        title="verify_live smoke test",
    )
    print(f"session: {session.id}")
    print(f"trace:   https://platform.claude.com/workspaces/default/sessions/{session.id}\n")

    # Send the test brief as if a human had just typed it into the chat box.
    client.beta.sessions.events.send(session.id, events=[
        {"type": "user.message", "content": [{"type": "text", "text": TEST_BRIEF}]},
    ])

    approved = False
    with client.beta.sessions.events.stream(session.id) as stream:
        for event in stream:
            t = event.type
            if t in ("session.thread_created", "session.thread_status_running",
                      "session.thread_status_idle"):
                # A "thread" is the coordinator's private sub-conversation with
                # one specialist subagent — these events mark a specialist
                # starting, working, or finishing its part of the job.
                print(f"[{t}] agent={getattr(event, 'agent_name', '?')}")
            elif t == "agent.message":
                # Plain conversational text from whichever agent is currently
                # speaking (could be the coordinator relaying progress, or a
                # subagent's own reasoning inside its private thread).
                text = "".join(b.text for b in (event.content or []) if getattr(b, "text", None))
                print(f"[agent.message]\n{text}\n")
            elif t == "agent.custom_tool_use":
                # bi-authoring is asking us to actually run validation — see
                # the CONCEPT note above. We must answer this before the
                # conversation can continue.
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
                # The whole session (coordinator included) has nothing left
                # to do right now — either it's paused waiting on a human
                # (requires_action), or the entire run is genuinely finished.
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
