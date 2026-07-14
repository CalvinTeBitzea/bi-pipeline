"""
WHAT THIS SCRIPT IS, IN BUSINESS TERMS
---------------------------------------
Companion to the new "Sample Rows (optional)" field added to the chat app's
setup panel (agent/components/SetupPanels.jsx) and wired into the first
message as a "## SAMPLE DATA ROWS" block (agent/components/ChatInterface.jsx)
alongside the existing "## DATA MODEL SCHEMA" / "## BUSINESS CONTEXT"
blocks. bi-planner's Dimension-value-coverage instruction (from
add_measure_guardrails.py, 2026-07-11) already technically covers this --
"check whether the raw input already tells you that column's real value
set" -- since sample rows are just more raw input. But it predates the
sample-rows field existing as a distinct, dedicated block, and it never
tells bi-planner to actively INVITE the user to supply sample rows as an
efficient way to answer several Dimension-value Open Questions at once
(Calvin's ask: make the agent proactively request example data rather than
asking one column's values at a time). This closes that gap.

Same live-update pattern as the other agent-configs/*.py scripts here
(retrieve -> exact-anchor replace -> update(version=...) -> verify),
idempotent. Anchor copied verbatim from a live `agents.retrieve()` call
immediately before writing this script -- bi-planner was at v4 (carries
add_measure_guardrails.py's Dimension-value-coverage bullet, not yet
touched by add_measure_integrity_guardrails.py, which only updated
bi-design/bi-authoring/coordinator).

Run once from agent/agent-configs/:
    python3 add_sample_rows_guidance.py
"""
from pathlib import Path

import anthropic
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE.parent / ".env.local")

BI_PLANNER_ID = "agent_016bjEDxxuKfgpR1kgyGeVij"


PLANNER_OLD = """- Dimension value coverage — for every candidate measure that needs to
  FILTER or COMPARE against specific values of a Dimension (not just
  group by/break down by it), check whether the raw input already tells
  you that column's real value set. If it doesn't, you MUST raise it
  under Open questions below, naming the exact column and asking for
  real example values (e.g. "What are the exact values in the 'Status'
  column? Please give 2-3 real examples.") — never assume or invent a
  plausible-sounding value set (e.g. guessing "Active"/"Inactive" when
  the real values might be "Open"/"Closed"). Flag/indicator (binary
  yes/no) columns are the one exception: if their representation isn't
  given, default to assuming numeric 1/0 or string "Yes"/"No" — the two
  standard Power BI conventions — state that assumption plainly in the
  spec instead of raising a question, unless the brief itself suggests a
  third, non-standard representation is actually in play."""

PLANNER_NEW = """- Dimension value coverage — for every candidate measure that needs to
  FILTER or COMPARE against specific values of a Dimension (not just
  group by/break down by it), check whether the raw input already tells
  you that column's real value set. A "## SAMPLE DATA ROWS" block, if
  present in the raw input, is real ground truth for this — use the
  actual values it shows and don't raise an Open Question for any column
  it already covers, even if only one example row is given. If a
  column's real values still aren't covered by anything in the raw
  input, you MUST raise it under Open questions below, naming the exact
  column and asking for real example values (e.g. "What are the exact
  values in the 'Status' column? Please give 2-3 real examples.") —
  never assume or invent a plausible-sounding value set (e.g. guessing
  "Active"/"Inactive" when the real values might be "Open"/"Closed").
  When you have more than one such column to ask about, say so
  explicitly and suggest the human paste a few real sample rows covering
  all of them at once — the fastest way to answer several Dimension-value
  questions in a single reply — rather than asking for one column's
  values at a time. Flag/indicator (binary yes/no) columns are the one
  exception: if their representation isn't given, default to assuming
  numeric 1/0 or string "Yes"/"No" — the two standard Power BI
  conventions — state that assumption plainly in the spec instead of
  raising a question, unless the brief itself suggests a third,
  non-standard representation is actually in play."""


def apply_replace(client, agent_id, old, new, label):
    agent = client.beta.agents.retrieve(agent_id)
    system = agent.system or ""
    if old not in system:
        if new in system:
            print(f"  {label}: already applied, skipping")
        else:
            print(f"  {label}: ANCHOR NOT FOUND -- live system prompt has diverged "
                  f"from the expected base text. Not touching it; inspect manually.")
        return
    new_system = system.replace(old, new, 1)
    updated = client.beta.agents.update(agent_id, version=agent.version, system=new_system)
    print(f"  {label}: v{agent.version} -> v{updated.version}")


def main() -> None:
    client = anthropic.Anthropic()
    apply_replace(client, BI_PLANNER_ID, PLANNER_OLD, PLANNER_NEW, "bi-planner")


if __name__ == "__main__":
    main()
