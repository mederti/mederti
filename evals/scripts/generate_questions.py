#!/usr/bin/env python3
"""Generate 150-question YAML eval files from the per-persona matrices in
docs/persona-coverage-audit.md.

Output:
  evals/questions/sup.yaml  (30 questions)
  evals/questions/hcl.yaml
  evals/questions/gov.yaml
  evals/questions/ret.yaml
  evals/questions/hpr.yaml

Per-question schema follows audit §6.2 — id, persona, text, expected_status,
hallucination_risk (true when the audit's ⚠ marker is present), and reasonable
defaults for expected_tools_min / refusal_acceptable derived from the status.

Run:  python3 evals/scripts/generate_questions.py
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
AUDIT = ROOT / "docs" / "persona-coverage-audit.md"
OUT_DIR = ROOT / "evals" / "questions"

STATUS_EMOJI = {
    "🟢": "green",
    "🟡": "yellow",
    "🟠": "orange",
    "🔴": "red",
    "⚫": "black",
}

PERSONAS = ["SUP", "HCL", "GOV", "RET", "HPR"]

# Map persona to the full audit-bank text. The audit's per-persona table only
# shows truncated questions; we pull the full text from the question-bank
# section at the bottom of the prompt-source doc. Mederti's audit doc includes
# the bank inline near the top — extract from the line items.
BANK_PATH = Path("/Users/findlaysingapore/Desktop/Mederti/mederti-persona-coverage-audit-prompt-v2-unified.md")


def parse_question_bank(text: str) -> dict[str, str]:
    """Return {id -> full question text} parsed from the prompt's question bank."""
    out: dict[str, str] = {}
    for m in re.finditer(r"^\|\s*(SUP|HCL|GOV|RET|HPR)-(\d{2})\s*\|\s*([^|]+?)\s*\|", text, re.MULTILINE):
        qid = f"{m.group(1)}-{m.group(2)}"
        q = m.group(3).strip()
        out[qid] = q
    return out


def parse_audit_matrix(text: str) -> dict[str, dict]:
    """Return {id -> {status, hallucination_risk, dominant_gap}} from the audit doc."""
    out: dict[str, dict] = {}
    # Match lines like: | SUP-02 | ... | 🟡 | Tool function | ... | Tool/function |
    # The ⚠ marker may appear after the ID: | SUP-15 ⚠ | ...
    line_re = re.compile(
        r"^\|\s*(SUP|HCL|GOV|RET|HPR)-(\d{2})\s*(⚠)?\s*\|"
        r"[^|]+\|\s*"
        r"([🟢🟡🟠🔴⚫])"
        r"\s*\|\s*([^|]+?)\s*\|",
        re.MULTILINE,
    )
    for m in line_re.finditer(text):
        qid = f"{m.group(1)}-{m.group(2)}"
        out[qid] = {
            "status": STATUS_EMOJI[m.group(4)],
            "hallucination_risk": bool(m.group(3)),
            "dominant_gap": m.group(5).strip(),
        }
    return out


def expected_tools_for(qid: str, status: str) -> list[str]:
    """Heuristic mapping from question ID to tools the model should be calling."""
    # Persona-default tool sets — refined per-question for known cases.
    persona = qid.split("-")[0]
    common = {
        "SUP-01": ["list_active_shortages", "get_drug_details"],
        "SUP-02": ["get_sole_source_essentials"],
        "SUP-05": ["compare_shortage_burden"],
        "SUP-10": ["summarize_shortage_landscape"],
        "SUP-22": ["get_drug_details", "get_resolution_time_stats"],
        "SUP-24": ["get_class_concentration_risk"],
        "SUP-25": ["get_predictive_signals"],
        "HCL-03": ["summarize_shortage_landscape"],
        "HCL-08": ["get_class_concentration_risk"],
        "HCL-12": ["get_resolution_time_stats"],
        "HCL-14": ["find_substitutes"],
        "HCL-16": ["find_substitutes"],
        "HCL-20": ["get_resolution_time_stats"],
        "GOV-01": ["summarize_shortage_landscape"],
        "GOV-02": ["get_sole_source_essentials"],
        "GOV-03": ["get_class_concentration_risk"],
        "GOV-04": ["get_class_concentration_risk", "get_sole_source_essentials"],
        "GOV-05": ["compare_shortage_burden", "get_resolution_time_stats"],
        "GOV-11": ["get_sole_source_essentials"],
        "GOV-13": ["compare_shortage_burden"],
        "GOV-14": ["compare_shortage_burden"],
        "GOV-15": ["compare_shortage_burden"],
        "GOV-18": ["summarize_shortage_landscape"],
        "GOV-19": ["get_sole_source_essentials"],
        "GOV-21": ["get_resolution_time_stats"],
        "GOV-24": ["get_class_concentration_risk"],
        "GOV-27": ["get_class_concentration_risk"],
        "GOV-28": ["get_predictive_signals"],
        "RET-01": ["get_drug_details"],
        "RET-05": ["find_substitutes"],
        "RET-10": ["get_drug_details"],
        "RET-13": ["find_substitutes"],
        "RET-14": ["find_substitutes", "get_drug_details"],
        "RET-16": ["get_predictive_signals"],
        "RET-23": ["get_drug_details", "get_resolution_time_stats"],
        "RET-24": ["get_class_summary"],
        "RET-28": ["get_drug_details"],
        "HPR-10": ["get_resolution_time_stats"],
        "HPR-22": ["find_substitutes"],
    }
    if qid in common:
        return common[qid]
    if status == "red":
        return []  # refusal-only — model should not be calling tools and inventing data
    if status == "black":
        return []  # forecast refusal — no tools satisfy
    # Default minimum: search_drugs + get_drug_details for any single-drug question
    if persona == "RET":
        return ["search_drugs", "get_drug_details"]
    if persona in ("HCL", "HPR"):
        return ["search_drugs", "get_drug_details"]
    if persona == "GOV":
        return ["summarize_shortage_landscape"]
    return ["search_drugs", "get_drug_details"]


def yaml_quote(s: str) -> str:
    """Quote a string for safe YAML inclusion."""
    s = s.replace('"', '\\"')
    return f'"{s}"'


def render_persona(persona: str, bank: dict[str, str], matrix: dict[str, dict]) -> str:
    lines: list[str] = []
    lines.append(f"# Mederti persona-coverage eval — {persona}")
    lines.append(f"# Generated by evals/scripts/generate_questions.py from docs/persona-coverage-audit.md")
    lines.append("# Schema documented in audit §6.2. Hand-edit fields freely; this generator is")
    lines.append("# idempotent only on regeneration if you re-merge edits.")
    lines.append("")
    lines.append(f"persona: {persona}")
    lines.append("questions:")
    for n in range(1, 31):
        qid = f"{persona}-{n:02d}"
        if qid not in bank:
            continue
        info = matrix.get(qid, {"status": "yellow", "hallucination_risk": False, "dominant_gap": "Tool function"})
        text = bank[qid]
        # Substitute audit placeholders with sensible defaults so the eval is runnable.
        text_resolved = (
            text.replace("[country]", "Australia")
            .replace("[market]", "Australia")
            .replace("[drug]", "amoxicillin")
            .replace("[substitute]", "cefalexin")
            .replace("[supplier]", "Sandoz")
            .replace("[drug A]", "amoxicillin")
            .replace("[drug B]", "cefalexin")
            .replace("[shortage drug]", "amoxicillin")
        )
        refusal_acceptable = info["status"] in ("red", "black") or info["hallucination_risk"]
        tools = expected_tools_for(qid, info["status"])
        lines.append(f"  - id: {qid}")
        lines.append(f"    text: {yaml_quote(text_resolved)}")
        lines.append(f"    original_text: {yaml_quote(text)}")
        lines.append(f"    expected_status: {info['status']}")
        lines.append(f"    dominant_gap: {yaml_quote(info['dominant_gap'])}")
        lines.append(f"    hallucination_risk: {str(info['hallucination_risk']).lower()}")
        lines.append(f"    refusal_acceptable: {str(refusal_acceptable).lower()}")
        if tools:
            lines.append("    expected_tools_min:")
            for t in tools:
                lines.append(f"      - {t}")
        else:
            lines.append("    expected_tools_min: []  # refusal-only — model should not call tools")
        lines.append("    expected_provenance:")
        # Refusal-only questions don't need <sources>; everything else does.
        sources_required = info["status"] not in ("red", "black") and not info["hallucination_risk"]
        lines.append(f"      must_emit_sources_block: {str(sources_required).lower()}")
        if sources_required:
            lines.append("      min_regulators_cited: 1")
        lines.append("    expected_confidence:")
        if info["status"] == "black":
            lines.append("      type: none  # forecast refusal — confidence template overrides")
        elif refusal_acceptable:
            lines.append("      type: qualitative")
        else:
            lines.append("      type: rules_based")
            lines.append("      must_state_basis: true")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    if not BANK_PATH.exists():
        print(f"FATAL: question bank not found at {BANK_PATH}", file=sys.stderr)
        return 2
    if not AUDIT.exists():
        print(f"FATAL: audit doc not found at {AUDIT}", file=sys.stderr)
        return 2

    bank = parse_question_bank(BANK_PATH.read_text())
    matrix = parse_audit_matrix(AUDIT.read_text())

    if len(bank) < 140:
        print(f"WARN: parsed only {len(bank)} questions from bank — expected 150", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    total = 0
    for persona in PERSONAS:
        text = render_persona(persona, bank, matrix)
        out = OUT_DIR / f"{persona.lower()}.yaml"
        out.write_text(text)
        n = text.count("- id:")
        total += n
        print(f"  wrote {out.relative_to(ROOT)} — {n} questions")
    print(f"Total: {total} questions encoded.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
