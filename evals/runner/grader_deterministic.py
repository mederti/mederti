"""Deterministic grader for Mederti chat answers.

Checks observable signals — tool calls, citation block presence, coverage-gate
behaviour, confidence presence — without needing an LLM-as-judge. Cheap to run
on every PR; provides regression protection between full judge runs.

Usage from run_eval.py:

    from grader_deterministic import grade_deterministic
    result = grade_deterministic(question_spec, chat_response, tool_calls)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

# ---- Regexes for structural checks --------------------------------------

SOURCES_RE = re.compile(r"<sources>(.*?)</sources>", re.DOTALL | re.IGNORECASE)
DRUG_CARD_RE = re.compile(r"<drug_card\s+id=\"([0-9a-f-]{36})\"", re.IGNORECASE)
FOLLOWUPS_RE = re.compile(r"<followups>(.*?)</followups>", re.IGNORECASE)
KPIS_RE = re.compile(r"<kpis>(.*?)</kpis>", re.IGNORECASE)

# Coverage gate "not_indexed" languaging — the model is supposed to say
# "Mederti doesn't currently track" verbatim per the refusal templates.
NOT_INDEXED_PHRASES = [
    "doesn't currently track",
    "doesn't track",
    "doesn't index",
    "not in our coverage",
]

# Hedging language a low-confidence answer should use.
HEDGING_PHRASES = [
    "regulator-reported",
    "single source",
    "not yet corroborated",
    "preliminary signal",
    "preliminary indicator",
    "data is stale",
    "treat as directional",
    "thin sample",
    "thin for",
    "stale",  # broad — relies on context
]

# Forecast-template marker phrases that should appear when the question wants
# an ETA but Mederti has no forecast model.
FORECAST_REFUSAL_PHRASES = [
    "doesn't yet ship a structured resolution forecast",
    "doesn't ship a structured",
    "not a confidence-calibrated forecast",
    "regulator's own estimate",
    "directional only",
]

# Eligibility-template marker phrases for Section 19A / SSP / 503B / Art 5(2).
ELIGIBILITY_REFUSAL_PHRASES = [
    "doesn't currently index the live eligibility list",
    "doesn't index the live",
    "eligibility is determined per-application",
    "canonical source",
    "canonical lookup",
]


@dataclass
class DeterministicResult:
    """Per-question deterministic grade. All checks default to pass; a missing
    expected signal flips the relevant field to False with a `notes` entry."""

    question_id: str
    expected_tools_called: bool = True
    tools_called_observed: list[str] = field(default_factory=list)
    sources_block_present: bool = True
    sources_min_regulators_met: bool = True
    confidence_referenced: bool = True
    not_indexed_phrasing_when_required: bool = True
    refusal_template_match: bool = True
    hedging_language_when_low_confidence: bool = True
    notes: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(
            [
                self.expected_tools_called,
                self.sources_block_present,
                self.sources_min_regulators_met,
                self.confidence_referenced,
                self.not_indexed_phrasing_when_required,
                self.refusal_template_match,
                self.hedging_language_when_low_confidence,
            ]
        )


# ---- Core grading ---------------------------------------------------------


def grade_deterministic(
    question: dict[str, Any],
    chat_response: dict[str, Any],
    tool_calls: list[str] | None = None,
) -> DeterministicResult:
    """Grade a single question's chat response.

    Args:
      question: parsed YAML entry from evals/questions/*.yaml
      chat_response: parsed JSON from /api/chat (must have `.content`)
      tool_calls: list of tool names invoked (in order), or None when the
                  harness can't observe (e.g. live prod runs without instrumentation)

    Returns:
      DeterministicResult with `.passed` summarising whether every binary
      check held.
    """
    qid = question.get("id", "?")
    content = (chat_response.get("content") or "").lower()
    raw = chat_response.get("content") or ""
    r = DeterministicResult(question_id=qid, tools_called_observed=tool_calls or [])

    # ── 1. expected_tools_min — were the required tools called? ──────────
    expected_tools = question.get("expected_tools_min") or []
    if tool_calls is not None and expected_tools:
        missing = [t for t in expected_tools if t not in tool_calls]
        if missing:
            r.expected_tools_called = False
            r.notes.append(f"missing expected tools: {missing}")

    # ── 2. <sources> block presence ──────────────────────────────────────
    expected_sources = (question.get("expected_provenance") or {}).get("must_emit_sources_block", False)
    sources_match = SOURCES_RE.search(raw)
    if expected_sources and not sources_match:
        r.sources_block_present = False
        r.notes.append("expected <sources> block missing")
    if expected_sources and sources_match:
        # Count pipe-separated entries to approximate regulator count.
        body = sources_match.group(1)
        entries = [e for e in body.split("|") if e.strip()]
        min_regs = (question.get("expected_provenance") or {}).get("min_regulators_cited", 1)
        if len(entries) < min_regs:
            r.sources_min_regulators_met = False
            r.notes.append(f"<sources> has {len(entries)} entries, expected ≥{min_regs}")

    # ── 3. confidence referenced when type=rules_based ───────────────────
    confidence_spec = question.get("expected_confidence") or {}
    if confidence_spec.get("type") == "rules_based":
        # Look for any of: "high confidence", "medium confidence", "low confidence",
        # "scraped today" (freshness language from confidence.basis), or the
        # word "confidence" preceded by an adjective.
        if not (
            re.search(r"(high|medium|low)\s+confidence", content)
            or re.search(r"confidence\s+(is|=|here)", content)
            or "scraped today" in content
            or "scraped yesterday" in content
        ):
            r.confidence_referenced = False
            r.notes.append("rules_based confidence expected but no level/basis surfaced in answer")

    # ── 4. not_indexed phrasing when refusal_acceptable for stale/coverage ─
    expected_status = question.get("expected_status")
    refusal_acceptable = bool(question.get("refusal_acceptable"))
    if refusal_acceptable and expected_status in ("red", "black"):
        # Should plainly say "Mederti doesn't" something.
        if not any(p in content for p in NOT_INDEXED_PHRASES + FORECAST_REFUSAL_PHRASES + ELIGIBILITY_REFUSAL_PHRASES):
            # Last chance: any "Mederti" + "doesn't" pairing.
            if not (re.search(r"mederti\s+doesn'?t", content)):
                r.refusal_template_match = False
                r.notes.append("refusal-acceptable question but no §11 template language found")

    # ── 5. hallucination_risk + hedging language ─────────────────────────
    if question.get("hallucination_risk"):
        if not any(p in content for p in HEDGING_PHRASES):
            r.hedging_language_when_low_confidence = False
            r.notes.append("hallucination_risk question but no hedging language present")

    # ── 6. forecast-template specific check ──────────────────────────────
    # If the question text mentions "forecast" or "when will" + "confidence",
    # the forecast-template phrases should appear.
    txt = (question.get("text") or "").lower()
    wants_forecast = (
        "forecast" in txt or ("when will" in txt and "confidence" in txt) or "with what confidence" in txt
    )
    if wants_forecast:
        if not any(p in content for p in FORECAST_REFUSAL_PHRASES):
            r.refusal_template_match = False
            r.notes.append("forecast question but no forecast-refusal template phrase found")

    return r


# ---- Aggregation helpers --------------------------------------------------


def summarise(results: list[DeterministicResult]) -> dict[str, Any]:
    total = len(results)
    passed = sum(1 for r in results if r.passed)
    fail_by_field = {
        "expected_tools_called": sum(1 for r in results if not r.expected_tools_called),
        "sources_block_present": sum(1 for r in results if not r.sources_block_present),
        "sources_min_regulators_met": sum(1 for r in results if not r.sources_min_regulators_met),
        "confidence_referenced": sum(1 for r in results if not r.confidence_referenced),
        "not_indexed_phrasing_when_required": sum(
            1 for r in results if not r.not_indexed_phrasing_when_required
        ),
        "refusal_template_match": sum(1 for r in results if not r.refusal_template_match),
        "hedging_language_when_low_confidence": sum(
            1 for r in results if not r.hedging_language_when_low_confidence
        ),
    }
    return {
        "total": total,
        "passed": passed,
        "pass_rate": (passed / total) if total else 0.0,
        "failures_by_dimension": fail_by_field,
    }
