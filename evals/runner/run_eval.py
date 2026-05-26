"""Mederti persona-coverage eval runner.

Reads evals/questions/*.yaml, hits a Mederti /api/chat endpoint, and grades
each answer with grader_deterministic + (optionally) grader_judge. Writes a
markdown report to evals/reports/<date>_<scope>.md.

Usage:
  # Full 150-question run against local dev server (default)
  python3 evals/runner/run_eval.py

  # Against production
  MEDERTI_CHAT_URL=https://mederti.vercel.app/api/chat python3 evals/runner/run_eval.py

  # PR-mode subset (6 per persona, weighted toward GREEN + ⚠)
  python3 evals/runner/run_eval.py --pr

  # Skip Claude-as-judge (deterministic grader only — much cheaper)
  python3 evals/runner/run_eval.py --no-judge

  # Specific persona only
  python3 evals/runner/run_eval.py --persona SUP

Env:
  MEDERTI_CHAT_URL      — default http://localhost:3000/api/chat
  MEDERTI_EVAL_GOLD_DIR — default evals/gold
  ANTHROPIC_API_KEY     — required for --judge (default)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Stdlib YAML is enough for our simple-schema files.
try:
    import yaml  # type: ignore
except ImportError:
    print("FATAL: PyYAML required. pip install pyyaml", file=sys.stderr)
    sys.exit(2)

THIS = Path(__file__).resolve()
ROOT = THIS.parent.parent.parent
sys.path.insert(0, str(THIS.parent))
from grader_deterministic import grade_deterministic, summarise as det_summarise  # noqa: E402
from grader_judge import grade_judge, summarise as judge_summarise  # noqa: E402


CHAT_URL = os.environ.get("MEDERTI_CHAT_URL", "http://localhost:3000/api/chat")
GOLD_DIR = Path(os.environ.get("MEDERTI_EVAL_GOLD_DIR", str(ROOT / "evals" / "gold")))
REPORT_DIR = ROOT / "evals" / "reports"

# Audit §6.4 — 10 gold-graded calibration questions
GOLD_IDS = {"SUP-01", "SUP-19", "HCL-13", "HCL-15", "GOV-01", "GOV-14", "RET-05", "RET-08", "HPR-25", "SUP-23"}

# PR-mode subset: 6 per persona, weighted toward GREEN + ⚠ — the highest-leverage
# questions for catching regressions on a normal PR.
PR_SUBSET_IDS = {
    "SUP-01", "SUP-02", "SUP-10", "SUP-15", "SUP-19", "SUP-23",
    "HCL-03", "HCL-04", "HCL-14", "HCL-15", "HCL-16", "HCL-17",
    "GOV-01", "GOV-02", "GOV-12", "GOV-14", "GOV-18", "GOV-26",
    "RET-01", "RET-05", "RET-08", "RET-10", "RET-23", "RET-25",
    "HPR-13", "HPR-16", "HPR-22", "HPR-23", "HPR-25", "HPR-27",
}


def load_questions(persona_filter: list[str] | None = None) -> list[dict]:
    qs: list[dict] = []
    questions_dir = ROOT / "evals" / "questions"
    for fp in sorted(questions_dir.glob("*.yaml")):
        persona = fp.stem.upper()
        if persona_filter and persona not in persona_filter:
            continue
        with fp.open() as f:
            data = yaml.safe_load(f)
        for q in (data.get("questions") or []):
            q.setdefault("persona", persona)
            qs.append(q)
    return qs


def ask_chat(question_text: str, *, timeout: int = 240) -> dict:
    req_body = json.dumps({"messages": [{"role": "user", "text": question_text}]}).encode()
    req = urllib.request.Request(
        CHAT_URL,
        data=req_body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8", "replace")
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        parsed = {"content": "", "error": f"non-JSON response: {body[:500]}"}
    parsed["_elapsed_sec"] = round(time.time() - t0, 2)
    return parsed


def load_gold(qid: str) -> str | None:
    fp = GOLD_DIR / f"{qid}.md"
    return fp.read_text() if fp.exists() else None


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--pr", action="store_true", help="Run the 30-question PR subset instead of all 150.")
    p.add_argument("--no-judge", action="store_true", help="Skip Claude-as-judge; deterministic grader only.")
    p.add_argument("--persona", action="append", help="Filter to one or more personas (SUP/HCL/GOV/RET/HPR).")
    p.add_argument("--limit", type=int, default=None, help="Stop after N questions (for sanity runs).")
    p.add_argument("--scope-label", default="full", help="Report-name suffix (default 'full').")
    args = p.parse_args()

    personas = [s.upper() for s in (args.persona or [])] or None
    questions = load_questions(personas)
    if args.pr:
        questions = [q for q in questions if q["id"] in PR_SUBSET_IDS]
        args.scope_label = "pr"
    if args.limit:
        questions = questions[: args.limit]

    print(f"# Mederti eval — {args.scope_label}")
    print(f"# Endpoint: {CHAT_URL}")
    print(f"# Questions: {len(questions)}")
    print(f"# Judge: {'OFF' if args.no_judge else 'ON'}")
    print()

    rows: list[dict] = []
    for i, q in enumerate(questions, 1):
        qid = q["id"]
        print(f"[{i}/{len(questions)}] {qid} ...", end="", flush=True)
        try:
            resp = ask_chat(q["text"])
        except Exception as e:
            print(f" ERR ({e})")
            rows.append({"id": qid, "error": str(e)})
            continue

        det = grade_deterministic(q, resp, tool_calls=None)
        row = {
            "id": qid,
            "persona": q.get("persona"),
            "expected_status": q.get("expected_status"),
            "elapsed_sec": resp.get("_elapsed_sec"),
            "deterministic_pass": det.passed,
            "deterministic_notes": det.notes,
        }
        if not args.no_judge:
            gold = load_gold(qid)
            judge = grade_judge(q, resp, gold_answer=gold)
            row["judge_pass"] = judge.passed
            row["judge_summary"] = judge.summary
            if judge.raw:
                row["judge_raw"] = judge.raw
        rows.append(row)
        verdict = "✓" if row.get("deterministic_pass") and (args.no_judge or row.get("judge_pass")) else "✗"
        print(f" {verdict} ({resp.get('_elapsed_sec', '?')}s)")

    # ── Report ─────────────────────────────────────────────────────────
    REPORT_DIR.mkdir(exist_ok=True, parents=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M")
    out_path = REPORT_DIR / f"{stamp}_{args.scope_label}.md"

    det_results = []
    for r in rows:
        from grader_deterministic import DeterministicResult
        if "error" in r:
            continue
        dr = DeterministicResult(question_id=r["id"])
        dr.notes = r["deterministic_notes"]
        # Re-derive pass from the boolean
        if not r["deterministic_pass"]:
            dr.expected_tools_called = False
        det_results.append(dr)

    det_summary = det_summarise(det_results)
    judge_summary = None
    if not args.no_judge:
        from grader_judge import JudgeResult
        jrs = []
        for r in rows:
            if "error" in r:
                continue
            jr = JudgeResult(question_id=r["id"], raw=r.get("judge_raw") or {})
            if not r.get("judge_pass") and jr.raw:
                jr.raw["passed_overall"] = False
            jrs.append(jr)
        judge_summary = judge_summarise(jrs)

    with out_path.open("w") as fh:
        fh.write(f"# Mederti eval — {args.scope_label}\n\n")
        fh.write(f"- Run: {stamp} UTC\n")
        fh.write(f"- Endpoint: `{CHAT_URL}`\n")
        fh.write(f"- Questions: {len(questions)}\n")
        fh.write(f"- Judge: {'OFF' if args.no_judge else 'ON'}\n\n")
        fh.write("## Headline\n\n")
        fh.write(f"- Deterministic pass: **{det_summary['passed']}/{det_summary['total']}** ({det_summary['pass_rate']:.1%})\n")
        if judge_summary:
            fh.write(f"- Judge pass: **{judge_summary['passed']}/{judge_summary['total']}** ({judge_summary['pass_rate']:.1%})\n")
            if judge_summary.get("judge_parse_errors"):
                fh.write(f"- Judge parse errors: {judge_summary['judge_parse_errors']}\n")
        fh.write("\n## Deterministic failures by dimension\n\n")
        for k, v in det_summary["failures_by_dimension"].items():
            fh.write(f"- {k}: {v}\n")
        fh.write("\n## Per-question (markdown table)\n\n")
        cols = ["id", "persona", "expected_status", "elapsed_sec", "deterministic_pass"]
        if not args.no_judge:
            cols.append("judge_pass")
        cols.append("notes")
        fh.write("| " + " | ".join(cols) + " |\n")
        fh.write("|" + "|".join(["---"] * len(cols)) + "|\n")
        for r in rows:
            notes = "; ".join(r.get("deterministic_notes") or [])
            if not args.no_judge and r.get("judge_summary"):
                notes = (notes + " // judge: " + r["judge_summary"]).strip(" //")
            row_vals = [
                r["id"],
                r.get("persona", ""),
                str(r.get("expected_status", "")),
                str(r.get("elapsed_sec", "")),
                "✓" if r.get("deterministic_pass") else "✗",
            ]
            if not args.no_judge:
                row_vals.append("✓" if r.get("judge_pass") else "✗")
            row_vals.append(notes[:200])
            fh.write("| " + " | ".join(row_vals) + " |\n")

    print()
    print(f"Report: {out_path.relative_to(ROOT)}")
    print(f"Deterministic: {det_summary['passed']}/{det_summary['total']} ({det_summary['pass_rate']:.1%})")
    if judge_summary:
        print(f"Judge:         {judge_summary['passed']}/{judge_summary['total']} ({judge_summary['pass_rate']:.1%})")
    return 0 if det_summary["pass_rate"] >= 0.0 else 1  # never fail the runner; CI sets its own threshold


if __name__ == "__main__":
    sys.exit(main())
