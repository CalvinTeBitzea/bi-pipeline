"""
WHAT THIS SCRIPT IS, IN BUSINESS TERMS
---------------------------------------
Follow-up to add_measure_guardrails.py (2026-07-11, commit 5b93234). That
guardrail told bi-design to flag an unconfirmed Dimension value in
dashboard_spec.json's "missing" array instead of guessing it -- but nothing
stopped bi-design from just deleting or defanging the measure instead of
flagging it, and bi-authoring's own check only looks for an unconfirmed DAX
literal-value comparison, so a deleted measure leaves nothing behind to
catch. Worse: bi-authoring is never given the approved spec (bi-planner has
no write tool -- the spec exists only as prose relayed by the coordinator),
so even a motivated bi-authoring check has no ground truth to confirm "did
every candidate measure survive" against. Calvin's live retest of 5b93234
came back with missing/scrambled measures, consistent with this gap.

Three changes, all live-applied the same way as add_measure_guardrails.py
(retrieve -> exact-anchor replace -> update(version=...) -> verify):

1. bi-design: explicit "never drop a candidate measure to dodge the
   guardrail" rule -- every spec-named measure must appear in
   semantic_model.json by name, one way or another.
2. Coordinator: restructured orchestration flow --
   a. extracts and re-relays a short Candidate Measures list (not the full
      spec prose) to bi-authoring on every round, since subagents don't
      retain it themselves;
   b. checks dashboard_spec.json's "missing" array immediately after EVERY
      bi-design output (first pass and every revision), before ever
      invoking bi-authoring, instead of only checking once at the very end
      after burning up to 3 rounds of the (expensive, Opus-tier)
      bi-authoring validation loop on a spec already known to have gaps;
   c. gives that missing-triggered info-gathering loop its own 2-round cap,
      kept separate from the existing 3-round bi-design<->bi-authoring
      validation budget, so waiting on the human for data can't silently
      eat the retry budget meant for design/authoring convergence.
3. bi-authoring: cross-references the coordinator-relayed Candidate
   Measures list against semantic_model.json's actual "measures" array by
   name -- any spec-named measure missing without a "missing" entry
   explaining why is now a reportable issue on its own, closing the gap
   that let a silently-dropped measure pass as "ready."

Idempotent, same as add_measure_guardrails.py: each update checks whether
its OLD anchor text is still present verbatim in the LIVE system prompt
before touching it. All three anchors below were copied verbatim from a
live `agents.retrieve()` call made immediately before writing this script
(NOT from the .agent.yaml files' indentation, which strips differently --
see the add_measure_guardrails.py gotcha this repeats) -- coordinator was at
v16, bi-design at v6, bi-authoring at v6 at that time (both already carry
5b93234's guardrail).

Run once from agent/agent-configs/:
    python3 add_measure_integrity_guardrails.py
"""
from pathlib import Path

import anthropic
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE.parent / ".env.local")

COORDINATOR_ID  = "agent_01HRthjDm1bhdTXAqG8UBAK5"
BI_DESIGN_ID    = "agent_01Auw9HmVhn71m97DEwPGkui"
BI_AUTHORING_ID = "agent_014pXjcphcdvysd5PQKhyBBf"


DESIGN_OLD = """   non-standard representation is actually in play.

2. dashboard_spec.json"""

DESIGN_NEW = """   non-standard representation is actually in play.

   Never drop or silently simplify away a candidate measure that the
   approved spec named, just to avoid the Dimension-value guardrail above.
   Every measure the spec calls out must appear in semantic_model.json by
   name -- fully resolved, defaulted per the flag/1-0 convention, or
   accompanied by a "missing" entry -- but always present with a real,
   best-effort DAX expression. Deleting or defanging a measure instead of
   flagging it is exactly the failure this guardrail exists to prevent: it
   produces a schema-valid file with fewer or weaker measures than
   promised, with nothing left for the authoring stage to catch. The
   coordinator will relay the spec's Candidate Measures list to the
   authoring stage, which checks semantic_model.json against it by name.

2. dashboard_spec.json"""


AUTHORING_OLD = """   columns compared against 1/0 or "Yes"/"No" are expected and fine
   without a missing entry.
5. Once validate_ir reports valid: true and your own design-brief check
   finds nothing, tell the coordinator the report is ready to build —"""

AUTHORING_NEW = """   columns compared against 1/0 or "Yes"/"No" are expected and fine
   without a missing entry. Also check: the coordinator will relay a
   Candidate Measures list (names, from the approved spec) alongside
   bi-design's output on every round -- cross-reference it against
   semantic_model.json's actual "measures" array by name. Any spec-named
   measure that's missing without a corresponding "missing" array entry
   explaining why is a reportable issue on its own, even if the file is
   otherwise schema-valid -- report it back by name so the design stage
   either restores it or explicitly flags what's unconfirmed, rather than
   letting a silently-dropped measure pass as "ready."
5. Once validate_ir reports valid: true and your own design-brief check
   finds nothing, tell the coordinator the report is ready to build —"""


COORDINATOR_OLD = """Flow for every new report request:
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
3. Once approved, extract a short Candidate Measures list from the
   approved spec (each measure's name and, if it filters/compares against
   a Dimension, which column) — you'll need to re-relay this alongside
   bi-design's output on every round below, since neither bi-design nor
   bi-authoring retain the spec themselves. Delegate the full spec to
   bi-design.
4. After EVERY bi-design output — the first pass and every revision below
   — check dashboard_spec.json's top-level "missing" array immediately,
   BEFORE sending anything to bi-authoring. If it's non-empty, do NOT
   proceed to validation: relay each item to the user as a specific
   question and STOP, waiting for their reply, the same way step 2 does.
   Once answered, relay the answer to bi-design as a revision and repeat
   this check. This information-gathering loop has its own cap of 2
   rounds, separate from the validation budget in step 6 — if a spec
   still needs unconfirmed values after 2 rounds of asking, tell the user
   honestly what's still unresolved rather than continuing to loop.
5. Once "missing" is empty, pass bi-design's output to bi-authoring for
   validation, along with the Candidate Measures list from step 3 —
   bi-authoring needs it to check that no measure got silently dropped.
6. If bi-authoring reports issues, relay its specific, quoted feedback back
   to bi-design for a revision. Every bi-design revision goes back through
   step 4's "missing" check before returning to bi-authoring — don't send
   a revision straight to bi-authoring without re-checking it. Repeat up
   to 3 rounds of bi-design↔bi-authoring validation total (the step-4
   info-gathering rounds don't count against this budget). If issues
   remain after 3 rounds, tell the user honestly what's still wrong
   rather than declaring success.
7. Once bi-authoring reports the report ready, tell the user the files are
   ready and they can use the "Build PBIP" button."""


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
    apply_replace(client, BI_DESIGN_ID, DESIGN_OLD, DESIGN_NEW, "bi-design")
    apply_replace(client, BI_AUTHORING_ID, AUTHORING_OLD, AUTHORING_NEW, "bi-authoring")
    apply_replace(client, COORDINATOR_ID, COORDINATOR_OLD, COORDINATOR_NEW, "coordinator")


if __name__ == "__main__":
    main()
