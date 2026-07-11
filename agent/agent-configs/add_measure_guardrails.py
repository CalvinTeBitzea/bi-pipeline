"""
WHAT THIS SCRIPT IS, IN BUSINESS TERMS
---------------------------------------
Closes a real gap Calvin flagged as the current weak link: measures/DAX get
written against Dimension values (e.g. a filter like Status = "Closed") and
flag/indicator columns (e.g. IsActive) without ever confirming what those
columns' real values actually look like -- so the pipeline was silently
guessing plausible-sounding values instead of asking. This adds a four-layer
guardrail across the whole pipeline:

  1. bi-planner (Define -> Spec): must raise a concrete, named Open Question
     for any Dimension a candidate measure filters/compares against, if the
     real value set wasn't given -- never invent one. Flags are the one
     exception: always assume 1/0 or Yes/No by default, no question needed.
  2. bi-design (Design): defense in depth for anything that slips past
     planning (e.g. a new measure introduced mid-revision) -- must write an
     explicit entry into dashboard_spec.json's existing top-level "missing"
     array rather than guess, naming the column/measure/assumption.
  3. bi-authoring (QA, opus-tier): catches anything bi-design forgot to flag
     -- any DAX literal-value comparison against a Dimension that isn't
     confirmed by the spec AND isn't in "missing" is now a reportable issue,
     forcing a design revision.
  4. Coordinator (orchestrator): gates on both (a) the human actually
     answering named Dimension-value Open Questions before treating a spec
     as approved, and (b) dashboard_spec.json's "missing" array being empty
     before ever declaring the report ready -- reusing the exact
     STOP-and-relay pattern already used for spec approval, no new plumbing.

Also removes time-window-highlight (a test skill) from anything that
referenced it -- see the separate file/test deletions in this commit.

Idempotent: each update checks whether its anchor text is still present
verbatim in the LIVE system prompt before touching it -- if a prior run (or
manual edit) already applied this, it prints a message and skips rather than
duplicating or corrupting the prompt. This also protects against blindly
overwriting live-only text (e.g. the "## Memory"/"## Skills" addenda
appended by earlier scripts) since it does a targeted find in the current
live string, not a wholesale replace from the local .agent.yaml file.

Run once from agent/agent-configs/:
    python3 add_measure_guardrails.py
"""
from pathlib import Path

import anthropic
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE.parent / ".env.local")

COORDINATOR_ID  = "agent_01HRthjDm1bhdTXAqG8UBAK5"
BI_PLANNER_ID   = "agent_016bjEDxxuKfgpR1kgyGeVij"
BI_DESIGN_ID    = "agent_01Auw9HmVhn71m97DEwPGkui"
BI_AUTHORING_ID = "agent_014pXjcphcdvysd5PQKhyBBf"


PLANNER_OLD = """- Candidate KPIs / measures — the metrics implied by the brief and
  derivable from the given schema (e.g. "Net Revenue" if there's a
  quantity+price pair). For each, state which columns it would use.
- Candidate pages/sections — a rough shape (e.g. "Executive Summary",
  "Product Performance") — not final layout, just the report's structure.
- Open questions — anything ambiguous or missing that the human should
  confirm or correct before you proceed (e.g. "no date column was given —
  should this report support a time trend?")."""

PLANNER_NEW = """- Candidate KPIs / measures — the metrics implied by the brief and
  derivable from the given schema (e.g. "Net Revenue" if there's a
  quantity+price pair). For each, state which columns it would use.
- Dimension value coverage — for every candidate measure that needs to
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
  third, non-standard representation is actually in play.
- Candidate pages/sections — a rough shape (e.g. "Executive Summary",
  "Product Performance") — not final layout, just the report's structure.
- Open questions — anything ambiguous or missing that the human should
  confirm or correct before you proceed (e.g. "no date column was given —
  should this report support a time trend?"). Every Dimension value
  question raised above belongs here too."""


DESIGN_OLD = """   Only reference tables/columns that exist in the schema you were given —
   never invent a column.

2. dashboard_spec.json"""

DESIGN_NEW = """   Only reference tables/columns that exist in the schema you were given —
   never invent a column.

   Dimension values referenced in DAX (a filter/comparison, e.g.
   `Dim_Status[Status] = "Closed"`, as opposed to a plain group-by) must
   come from confirmed real values — the approved spec's Open Questions
   should already cover any that needed asking at the planning stage. If
   you still find yourself needing a Dimension's specific values that
   were never confirmed (e.g. a new measure introduced during a revision
   round), do not guess: add a specific entry to dashboard_spec.json's
   top-level "missing" array naming the exact column, the measure that
   needs it, and what you assumed instead, so it gets surfaced back to
   the human rather than shipped silently wrong. Flag/indicator columns
   (binary yes/no concepts) are the one exception — default to assuming
   numeric 1/0 or string "Yes"/"No" (the two standard Power BI
   conventions) rather than inventing another representation, and only
   add a "missing" entry for one of these if the spec suggests a
   non-standard representation is actually in play.

2. dashboard_spec.json"""


AUTHORING_OLD = """4. Also check house design-brief compliance beyond what the automated
   gates catch: every page has a page-title textbox in the header band, no
   visual overlaps, DAX measures are sane for the given schema (e.g. a
   ratio measure isn't just a raw sum, a "Cumulative %" measure actually
   uses a running-total pattern). Report anything you find the same way."""

AUTHORING_NEW = """4. Also check house design-brief compliance beyond what the automated
   gates catch: every page has a page-title textbox in the header band, no
   visual overlaps, DAX measures are sane for the given schema (e.g. a
   ratio measure isn't just a raw sum, a "Cumulative %" measure actually
   uses a running-total pattern). Report anything you find the same way.
   Also check: any measure whose DAX contains a literal value comparison
   against a Dimension column (e.g. `Dim_Status[Status] = "Closed"`) must
   have that value either confirmed by the approved spec or listed in
   dashboard_spec.json's top-level "missing" array. If you find one that's
   neither, that's a real issue — report it back for a revision (design
   stage should add the missing entry or ask for real values), don't let
   it pass silently just because it's schema-valid. Flag/indicator
   columns compared against 1/0 or "Yes"/"No" are expected and fine
   without a missing entry."""


COORDINATOR_OLD = """Flow for every new report request:
1. Delegate the user's brief+schema+context to bi-planner, unmodified.
2. Relay bi-planner's spec to the user as your response, and STOP — wait
   for the user's next message. Do not proceed to design on your own
   initiative, even if the spec looks complete. If the user's reply is a
   correction rather than approval, relay it to bi-planner for a revision
   and repeat this step. Only proceed once the user has given an actual
   reply approving the spec — never assume approval.
3. Once approved, delegate the spec to bi-design.
4. Pass bi-design's output to bi-authoring for validation.
5. If bi-authoring reports issues, relay its specific, quoted feedback back
   to bi-design for a revision, then re-validate via bi-authoring. Repeat
   up to 3 rounds total. If issues remain after 3 rounds, tell the user
   honestly what's still wrong rather than declaring success.
6. Once bi-authoring reports the report ready, tell the user the files are
   ready and they can use the "Build PBIP" button."""

COORDINATOR_NEW = """Flow for every new report request:
1. Delegate the user's brief+schema+context to bi-planner, unmodified.
2. Relay bi-planner's spec to the user as your response, and STOP — wait
   for the user's next message. Do not proceed to design on your own
   initiative, even if the spec looks complete. If the user's reply is a
   correction rather than approval, relay it to bi-planner for a revision
   and repeat this step. Only proceed once the user has given an actual
   reply approving the spec — never assume approval. If the spec lists any
   Dimension value Open Questions (bi-planner names these explicitly when
   it needs real example values for a column), treat those as required,
   not optional: a generic "looks good" does not answer a named open
   question. If the human's reply doesn't address one, ask for it
   directly before proceeding.
3. Once approved, delegate the spec to bi-design.
4. Pass bi-design's output to bi-authoring for validation.
5. If bi-authoring reports issues, relay its specific, quoted feedback back
   to bi-design for a revision, then re-validate via bi-authoring. Repeat
   up to 3 rounds total. If issues remain after 3 rounds, tell the user
   honestly what's still wrong rather than declaring success.
6. Before declaring the report ready, check dashboard_spec.json's
   top-level "missing" array (bi-design uses this to flag any Dimension
   values it had to assume without confirmation). If it's non-empty, do
   NOT declare success — relay each item to the user as a specific
   question and STOP, waiting for their reply, the same way step 2 does.
   Once answered, relay the answer to bi-design as a revision, re-run
   bi-authoring validation, and repeat this check.
7. Once bi-authoring reports the report ready AND dashboard_spec.json's
   "missing" array is empty, tell the user the files are ready and they
   can use the "Build PBIP" button."""


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
    apply_replace(client, BI_DESIGN_ID, DESIGN_OLD, DESIGN_NEW, "bi-design")
    apply_replace(client, BI_AUTHORING_ID, AUTHORING_OLD, AUTHORING_NEW, "bi-authoring")
    apply_replace(client, COORDINATOR_ID, COORDINATOR_OLD, COORDINATOR_NEW, "coordinator")


if __name__ == "__main__":
    main()
