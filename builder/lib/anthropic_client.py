# WHAT THIS FILE IS, IN BUSINESS TERMS
# -------------------------------------
# The one shared connection point between the (mostly deterministic)
# `builder` service and Anthropic's plain Claude API — a completely
# different, simpler integration than the Managed Agents API used in
# `agent/`. There's no persistent "Agent" object, no multi-turn session, no
# streaming — every call here is a single, one-shot question-and-answer
# request, used only for the few specific sub-tasks in the builder that
# still benefit from an AI model (e.g. drafting TMDL text — see
# pbip_builder.py's `_generate_tmdl`).
#
# CONCEPT: Using different-cost models for different jobs (again)
# -------------------------------------------------------------------------
# Same underlying idea as agent/lib/pricing.js's AGENT_MODEL mapping, applied
# on the builder side: not every AI call in this pipeline needs the most
# expensive model. `EXECUTOR_LIGHT` is a small, fast, cheap model reserved
# for purely mechanical tasks (masking data, generating dummy values) where
# there's no real judgment involved; `BRAIN` is the most capable model,
# reserved for planning/judgment calls where getting it right matters most.
#
# NOTE: these three model names are OLDER than the ones actually deployed in
# `agent/` today (see agent/lib/pricing.js's AGENT_MODEL, which uses
# claude-opus-4-8/claude-sonnet-5) — this file simply hasn't been migrated
# yet. Worth knowing when reading this file: it reflects an earlier point in
# this project's model-upgrade history, not a deliberate difference in
# strategy between the two sides of the pipeline.
import os
from anthropic import Anthropic

# Model tiers
BRAIN          = "claude-opus-4-7"             # planning, judgment, advisor calls
EXECUTOR_LIGHT = "claude-haiku-4-5-20251001"   # masking, dummy data (mechanical)
EXECUTOR_HEAVY = "claude-sonnet-4-6"           # requirements, wireframe (complex generation)

_client = None


def get_client() -> Anthropic:
    # CONCEPT: A lazily-created, cached client (singleton pattern)
    # The Anthropic client object is only constructed the FIRST time it's
    # actually needed, then reused for every subsequent call rather than
    # reconnecting from scratch each time — cheaper and avoids repeatedly
    # re-validating the API key. `global _client` is what lets this function
    # remember that cached object across separate calls.
    global _client
    if _client is None:
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        _client = Anthropic(api_key=key)
    return _client


def call_with_tool(
    system: str,
    user_message: str,
    tool_name: str,
    tool_schema: dict,
    model: str,
    max_tokens: int = 4096,
) -> dict:
    """Force the model to call a specific tool; returns tool input dict.

    CONCEPT: Forcing structured output via a single mandatory "tool"
    -------------------------------------------------------------------------
    Normally, a tool is something a model can OPTIONALLY decide to call.
    Here, `tool_choice={"type": "tool", "name": tool_name}` removes that
    choice — the model is required to respond by "calling" this one tool,
    which really just means "fill in these exact fields, in this exact JSON
    shape." This is a common trick for getting reliably structured output
    (e.g. "give me back {tmdl: '...'}") rather than parsing a plain-English
    reply and hoping it's formatted the way you expect.
    """
    client = get_client()
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        tools=[{
            "name": tool_name,
            "description": "Submit structured output for this stage.",
            "input_schema": tool_schema,
        }],
        tool_choice={"type": "tool", "name": tool_name},
        messages=[{"role": "user", "content": user_message}],
    )
    block = next(
        (b for b in response.content if b.type == "tool_use" and b.name == tool_name),
        None,
    )
    if not block:
        raise RuntimeError(f"Model did not call tool '{tool_name}'")
    return block.input


def consult_advisor(context: str, question: str) -> str:
    """
    Two-model advisor pattern: sends context + question to Opus, returns guidance.

    This mirrors the advisor tool contract (section 2 of the plan) without requiring
    beta access. When the advisor tool is confirmed, replace this body with an
    advisor_tool call using header 'advisor-tool-2026-03-01'.

    Call timing (from the plan):
      - Before substantive work (not for orientation/file-reading)
      - When stuck (contract failing, approach not converging)
      - After output is written, to confirm the stage looks complete

    CONCEPT: Getting a "second opinion" from a stronger/different model
    -------------------------------------------------------------------------
    The idea here — one process doing real work, pausing to ask a separate,
    more capable model for judgment on something uncertain — is a genuinely
    useful pattern for AI-assisted pipelines: it's cheaper to only invoke the
    strongest, most expensive model for the moments that actually need
    deeper judgment, rather than using it for every single step regardless
    of difficulty.
    """
    max_tokens = int(os.environ.get("ADVISOR_MAX_TOKENS", "2048"))
    client = get_client()
    response = client.messages.create(
        model=BRAIN,
        max_tokens=max_tokens,
        system=(
            "You are a strategic advisor for a Power BI automation pipeline. "
            "Read the context and answer the question. "
            "Keep guidance under 120 words. Be direct. No preamble."
        ),
        messages=[{
            "role": "user",
            "content": f"Context:\n{context}\n\nQuestion: {question}",
        }],
    )
    return response.content[0].text
