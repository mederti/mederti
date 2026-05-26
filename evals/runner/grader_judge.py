"""Claude-as-judge grader for Mederti chat answers.

Loads the 6-dim rubric (evals/rubric/product_standard.yaml) and asks Claude
to score each dimension for one model output. Returns structured pass/fail
plus per-dimension notes.

Cost-aware: judges on a single Sonnet call per question (input ~3k tokens
for rubric + question + gold + model_answer; output ~400 tokens for JSON).
The audit estimated $5–10 for a full 150-question run at $15 ceiling.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# anthropic SDK is optional at import time so the deterministic grader stays
# usable without the dependency.
try:
    from anthropic import Anthropic
except ImportError:  # pragma: no cover
    Anthropic = None  # type: ignore


JUDGE_MODEL = os.environ.get("MEDERTI_EVAL_JUDGE_MODEL", "claude-sonnet-4-20250514")
RUBRIC_PATH = Path(__file__).resolve().parent.parent / "rubric" / "product_standard.yaml"


JUDGE_SYSTEM = """You are a strict but fair eval grader for Mederti, a drug-shortage intelligence assistant for pharmacists, procurement teams, and regulators.

You will be given:
  1. The question Mederti was asked.
  2. The expected status (green/yellow/orange/red/black) from the audit.
  3. Whether refusal is acceptable for this question.
  4. Whether the question carries hallucination risk.
  5. (Optional) A gold-standard answer hand-graded by Mederti's team.
  6. The model's actual answer.

Score the answer on six dimensions per Mederti's product standard:

  factually_correct (binary)        — no invented numbers, no countries-out-of-coverage claims
  sourced (binary)                  — <sources> block present when DB rows backed the answer
  confidence_calibrated (binary)    — hedging matches the data; no fake forecasts
  clean_refusal (binary)            — when data missing, refuses cleanly with canonical lookup
  persona_aware (0-2)               — shape matches the JTBD if persona signaled
  synthesised (0-2)                 — composes ≥2 data points; not a row dump

Pass criteria: all 4 binary dims pass AND both 0-2 dims score ≥ 1.

Return JSON ONLY in this exact shape:

{
  "factually_correct": {"pass": true|false, "reason": "..."},
  "sourced": {"pass": true|false, "reason": "..."},
  "confidence_calibrated": {"pass": true|false, "reason": "..."},
  "clean_refusal": {"pass": true|false, "reason": "..."},
  "persona_aware": {"score": 0|1|2, "reason": "..."},
  "synthesised": {"score": 0|1|2, "reason": "..."},
  "passed_overall": true|false,
  "summary": "one-sentence verdict"
}

Be strict on factual correctness — if a number can't be verified from the model's tool outputs or cited sources, mark it failed. Be lenient on synthesised when the question is a quick lookup (it can earn 1 just by retrieving cleanly).
"""


@dataclass
class JudgeResult:
    question_id: str
    raw: dict[str, Any] = field(default_factory=dict)
    parse_error: str | None = None

    @property
    def passed(self) -> bool:
        if self.parse_error or not self.raw:
            return False
        return bool(self.raw.get("passed_overall"))

    @property
    def summary(self) -> str:
        return self.raw.get("summary") or self.parse_error or "(no judge output)"


def grade_judge(
    question: dict[str, Any],
    chat_response: dict[str, Any],
    gold_answer: str | None = None,
    *,
    client: Any | None = None,
) -> JudgeResult:
    qid = question.get("id", "?")
    if Anthropic is None:
        return JudgeResult(question_id=qid, parse_error="anthropic SDK not installed")
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return JudgeResult(question_id=qid, parse_error="ANTHROPIC_API_KEY missing")

    client = client or Anthropic()

    user_payload = {
        "question_id": qid,
        "question_text": question.get("text"),
        "expected_status": question.get("expected_status"),
        "refusal_acceptable": question.get("refusal_acceptable"),
        "hallucination_risk": question.get("hallucination_risk"),
        "expected_tools_min": question.get("expected_tools_min"),
        "model_answer": chat_response.get("content", ""),
        "gold_answer": gold_answer,
    }

    try:
        resp = client.messages.create(
            model=JUDGE_MODEL,
            max_tokens=1000,
            system=[{"type": "text", "text": JUDGE_SYSTEM, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": json.dumps(user_payload)}],
        )
    except Exception as e:  # network / API errors
        return JudgeResult(question_id=qid, parse_error=f"judge API error: {e}")

    text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")  # type: ignore[attr-defined]
    parsed = _extract_json(text)
    if parsed is None:
        return JudgeResult(question_id=qid, parse_error=f"could not parse judge JSON: {text[:200]}")

    # Compute passed_overall ourselves if absent — strict pass criteria.
    if "passed_overall" not in parsed:
        binaries = ["factually_correct", "sourced", "confidence_calibrated", "clean_refusal"]
        scales = ["persona_aware", "synthesised"]
        all_binary_pass = all(parsed.get(b, {}).get("pass") for b in binaries)
        all_scales_ok = all((parsed.get(s, {}).get("score") or 0) >= 1 for s in scales)
        parsed["passed_overall"] = bool(all_binary_pass and all_scales_ok)

    return JudgeResult(question_id=qid, raw=parsed)


def _extract_json(text: str) -> dict[str, Any] | None:
    """Best-effort JSON extraction. Tolerates ```json fences and extra prose."""
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        # Trim trailing commentary
        cleaned = re.sub(r",\s*([}\]])", r"\1", m.group(0))
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            return None


def summarise(results: list[JudgeResult]) -> dict[str, Any]:
    total = len(results)
    passed = sum(1 for r in results if r.passed)
    parse_errors = sum(1 for r in results if r.parse_error)
    return {
        "total": total,
        "passed": passed,
        "pass_rate": (passed / total) if total else 0.0,
        "judge_parse_errors": parse_errors,
    }
