# Eval CI workflow — manual install required

The CI plumbing for this eval suite is intentionally **not committed** in this PR. GitHub PATs without the `workflow` scope can't push files under `.github/workflows/`, and the automation token used to ship the rest of the sprint doesn't carry that scope.

To install:

1. **Copy** `evals/CI-WORKFLOW.md.template` → `.github/workflows/eval-coverage.yml` (verbatim — it's already valid YAML).
2. **Set repo secret** `ANTHROPIC_API_KEY` in GitHub repo settings → Secrets and variables → Actions.
3. **Wire the Vercel preview URL** — the workflow's `vercel-preview` step is a placeholder. Two options:
   - **Easy**: hard-code `MEDERTI_CHAT_URL=https://mederti.vercel.app/api/chat` to always grade production (skip the preview matrix).
   - **Right**: replace the placeholder step with a script that resolves the preview URL via the GitHub statuses API for the `Vercel - mederti` check. Vercel's GitHub integration posts the preview URL there.
4. **Commit** with workflow-scoped credentials (your account or a token created with `workflow` scope enabled).
5. **Run once via `workflow_dispatch`** with `scope=pr` to verify everything wires before the next PR triggers it automatically.

Cost notes per `evals/README.md` — full 150 with judge ≈ \$5, PR subset ≈ \$1, deterministic-only is free.
