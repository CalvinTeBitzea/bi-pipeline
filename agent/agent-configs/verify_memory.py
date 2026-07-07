"""
WHAT THIS SCRIPT IS, IN BUSINESS TERMS
---------------------------------------
This script is the specific test that proved the "shared lessons folder"
feature (see add_memory_instructions.py / fix_memory_read.py) actually
works, rather than just trusting that it should. It runs the exact same
customer brief through the full pipeline TWICE, in two completely separate,
brand-new conversations, and checks: did the second run make the same
mistakes as the first, or did it actually benefit from what the first run
wrote down? This is the difference between "we told the agents to use
memory" and "we confirmed memory usage measurably changes the outcome" —
the second is what actually matters to a business relying on this getting
more reliable over time, not just in theory.

CONCEPT: A "Memory Store" — durable knowledge that outlives a conversation
-------------------------------------------------------------------------------
Every conversation a customer has with this pipeline is independent — by
default, session 2 knows nothing about what happened in session 1, the same
way two different phone calls to a support line don't share notes unless
someone writes them down first. A "Memory Store" is Anthropic's mechanism
for exactly that: a small, permanent, shared filesystem that many DIFFERENT
sessions can be granted read/write access to. Attaching one to a session (see
the `resources=[{"type": "memory_store", ...}]` block below) is what lets
this run's bi-design/bi-authoring read lessons a completely different,
earlier run wrote — the mechanism that turns "the pipeline made a mistake
once" into "the pipeline doesn't make that mistake again," across every
future customer, not just within one conversation.

Run from agent/agent-configs/:
    python3 verify_memory.py
"""
import json
from pathlib import Path

import anthropic
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE.parent / ".env.local")

REFERENCE_SESSION_ID = "sesn_01S3zW6pLxWnwyxZ9rmB6tZB"
MEMORY_STORE_ID       = "memstore_01LvjHnGpcRYxQMFXE2UXFoU"
BICOHOST_URL          = "https://bi-cohost.vercel.app"

# Same test brief as verify_live.py — using an identical input across both
# runs is what makes this a fair, controlled comparison: any difference in
# outcome between run 1 and run 2 can only be explained by what's in memory,
# not by the input changing.
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


def run_validate_ir(inp: dict) -> tuple[str, bool]:
    """Same real validation round-trip as verify_live.py's helper of the
    same name — calls the live, deployed builder service's /api/validate
    endpoint and hands back its verdict."""
    import urllib.request
    body = json.dumps({
        "dashboard_spec": inp.get("dashboard_spec"),
        "semantic_model": inp.get("semantic_model"),
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


def run_pipeline(client: anthropic.Anthropic, label: str) -> list[str]:
    """Drives one full brief -> approve -> design -> authoring run. Returns
    the list of validate_ir result summaries seen, in order."""
    # A fresh session each call, but with the SAME memory_store_id attached —
    # this is the crucial setup detail: two independent conversations,
    # deliberately sharing one piece of persistent state between them, to
    # simulate "customer A's session, then months later customer B's
    # session" without actually waiting months.
    ref = client.beta.sessions.retrieve(REFERENCE_SESSION_ID)
    session = client.beta.sessions.create(
        agent=ref.agent.id, environment_id=ref.environment_id,
        title=f"verify_memory {label}",
        resources=[{
            "type": "memory_store",
            "memory_store_id": MEMORY_STORE_ID,
            "access": "read_write",
            "instructions": "Lessons learned from past dashboard-spec/semantic-model validation failures. Check for relevant entries before generating; write a new one when you fix a non-trivial mistake.",
        }],
    )
    print(f"[{label}] session: {session.id}")

    client.beta.sessions.events.send(session.id, events=[
        {"type": "user.message", "content": [{"type": "text", "text": TEST_BRIEF}]},
    ])

    # We track every validate_ir call and its outcome for this run — the
    # NUMBER of attempts before reaching "valid" is itself the key metric:
    # fewer attempts in run 2 than run 1 is direct evidence memory helped.
    validate_results = []
    approved = False
    with client.beta.sessions.events.stream(session.id) as stream:
        for event in stream:
            t = event.type
            if t == "agent.custom_tool_use" and event.name == "validate_ir":
                result_text, is_error = run_validate_ir(event.input or {})
                parsed = json.loads(result_text)
                summary = "valid" if parsed.get("valid") else f"invalid: {parsed.get('error', parsed.get('ingest_issues'))}"
                print(f"[{label}]   validate_ir -> {summary}")
                validate_results.append(summary)
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
                if stop_type == "requires_action":
                    continue
                if not approved:
                    print(f"[{label}] approving spec")
                    approved = True
                    client.beta.sessions.events.send(session.id, events=[
                        {"type": "user.message", "content": [{"type": "text", "text": "Looks good, approved — go ahead."}]},
                    ])
                    continue
                print(f"[{label}] done")
                break
            elif t in ("session.error", "session.status_terminated"):
                print(f"[{label}] {t}: {event}")
                break

    return validate_results


def list_lessons(client: anthropic.Anthropic) -> list[str]:
    """Lists what's actually written to the shared memory store right now —
    printed before/after each run so you can see, in the terminal output
    itself, exactly which lesson files got added and when."""
    return [m.path for m in client.beta.memory_stores.memories.list(MEMORY_STORE_ID) if m.type == "memory"]


def main() -> None:
    client = anthropic.Anthropic()

    print("=== lessons before run 1 ===")
    print(list_lessons(client))

    r1 = run_pipeline(client, "run1")

    print("\n=== lessons after run 1 ===")
    print(list_lessons(client))

    r2 = run_pipeline(client, "run2")

    print("\n=== lessons after run 2 ===")
    print(list_lessons(client))

    # The headline comparison: if memory is working, run 2 should need fewer
    # (ideally just one) validate_ir attempts than run 1, because it starts
    # out already knowing what run 1 had to discover the hard way.
    print(f"\nrun1 validate_ir attempts: {len(r1)} -> {r1}")
    print(f"run2 validate_ir attempts: {len(r2)} -> {r2}")


if __name__ == "__main__":
    main()
