# Mederti persona-coverage eval

The 150-question eval suite per `docs/persona-coverage-audit.md` §6. Grades every Mederti `/api/chat` answer against the strict product standard (correct + sourced + confidence-calibrated + clean refusal + persona-aware + synthesised).

## Quick start

```bash
# Local dev server on :3000, full 150-question run, deterministic + judge:
ANTHROPIC_API_KEY=... python3 evals/runner/run_eval.py

# Same but skip the LLM-as-judge (deterministic grader only — much cheaper):
python3 evals/runner/run_eval.py --no-judge

# PR-mode subset (30 questions, 6 per persona):
python3 evals/runner/run_eval.py --pr

# One persona only:
python3 evals/runner/run_eval.py --persona SUP

# Against production:
MEDERTI_CHAT_URL=https://mederti.vercel.app/api/chat python3 evals/runner/run_eval.py
```

Reports land in `evals/reports/<UTC-timestamp>_<scope>.md`.

## Directory layout

```
evals/
├── questions/                  # 150 questions, 30 per persona, YAML
│   ├── sup.yaml                # SUP — pharma importer / exporter
│   ├── hcl.yaml                # HCL — hospital clinical pharmacy
│   ├── gov.yaml                # GOV — government / regulator
│   ├── ret.yaml                # RET — retail / community pharmacist
│   └── hpr.yaml                # HPR — hospital procurement
├── gold/                       # 10 hand-graded gold answers for judge anchoring
│   └── *.md                    # (TODO — gold-grade with Rob present per audit §6.4)
├── rubric/
│   └── product_standard.yaml   # 6-dimension scoring rubric (audit §6.3)
├── runner/
│   ├── run_eval.py             # main harness — POSTs /api/chat, writes report
│   ├── grader_deterministic.py # tool calls, citation, coverage gate, confidence
│   └── grader_judge.py         # Claude-as-judge against the rubric
├── scripts/
│   └── generate_questions.py   # regenerate YAMLs from audit doc
└── reports/                    # generated reports (gitignored except baseline)
```

## Schema — per-question YAML

```yaml
- id: SUP-02
  text: "Which essential medicines currently have zero or single-source supply in Australia?"
  original_text: "Which essential medicines currently have zero or single-source supply in [market]?"
  expected_status: yellow           # audit classification: green / yellow / orange / red / black
  dominant_gap: "Tool function"     # audit's diagnosis
  hallucination_risk: false         # ⚠ marker present in audit?
  refusal_acceptable: false         # if true, a clean refusal counts as a pass
  expected_tools_min:               # at least one of these MUST be called
    - get_sole_source_essentials
  expected_provenance:
    must_emit_sources_block: true   # <sources> block required when DB rows backed the answer
    min_regulators_cited: 1
  expected_confidence:
    type: rules_based               # rules_based | qualitative | none
    must_state_basis: true          # confidence.basis must surface in prose
```

## Grading

Two graders run in sequence:

1. **Deterministic** (`grader_deterministic.py`) — pure string-and-regex checks:
   - Were the `expected_tools_min` called?
   - Is the `<sources>` block present with ≥ `min_regulators_cited` entries?
   - Is confidence referenced when `type: rules_based`?
   - Does refusal language land when `refusal_acceptable` + status in (red, black)?
   - For `hallucination_risk: true` — does hedging language appear?
   - For forecast-shaped questions — does the §11 forecast template phrase appear?

   Cheap to run on every PR. ~0¢ per question.

2. **Judge** (`grader_judge.py`) — Claude Sonnet scores the answer against the 6-dim rubric:
   - factually_correct (binary)
   - sourced (binary)
   - confidence_calibrated (binary)
   - clean_refusal (binary)
   - persona_aware (0–2)
   - synthesised (0–2)

   Pass = all 4 binaries pass AND both scales score ≥ 1. ~3¢ per question; ~$5 per full 150 run.

A question passes overall only when both graders pass.

## Gold standard (TODO)

Per audit §6.4, 10 calibration questions need hand-grading by Rob + a pharmacist before the judge can be trusted at full strictness. The 10 IDs:

```
SUP-01  basic retrieval — must pass
SUP-19  ⚠ forecast risk — must demonstrate calibrated refusal
SUP-23  ⚠ India/China API distress — must caveat scraper status
HCL-13  ⚠ substitute coverage caveat
HCL-15  ⚠ dose conversion — must refuse if missing, not invent
GOV-01  essentials filter
GOV-14  peer comparison synthesis
RET-05  substitute happy path
RET-08  ⚠ Section 19A / SSP eligibility — refusal template critical
HPR-25  network stock — must say "Mederti doesn't track hospital network inventory"
```

Workflow (with Rob):
1. Run `python3 evals/runner/run_eval.py --no-judge --limit 100` to grab live answers (or pull from a recent report).
2. For each of the 10 gold IDs, paste the live answer into `evals/gold/<ID>.md`.
3. Rob + a pharmacist annotate: pass/fail per dimension, with reasoning.
4. The judge prompt picks these up automatically as anchoring examples.

## CI

`.github/workflows/eval-coverage.yml`:
- **On PR** (chat-file change) — 30-question subset against Vercel preview, posts the report as a PR comment.
- **Nightly main** — full 150 against production, archives report as artifact.
- **Manual** — `gh workflow run eval-coverage.yml -f scope=full` for ad-hoc.

Set `ANTHROPIC_API_KEY` as a repo secret.

## Regenerating questions

```bash
python3 evals/scripts/generate_questions.py
```

This parses the per-persona matrices in `docs/persona-coverage-audit.md` and re-emits the YAML files. Hand edits to the YAMLs will be overwritten — keep custom changes in a separate file or modify the generator's heuristics.

## Cost notes

- Deterministic grader: free.
- Judge (Sonnet 4): ~$0.03 per question.
- Full 150-question judge run: ~$5.
- PR subset judge run: ~$1.
- Daily nightly + PRs averages out to ~$50/month at moderate PR volume.

If budget is a concern, run `--no-judge` on PRs and reserve full judging for nightly only.
