// Railway Infrastructure as Code for project "disciplined-analysis".
// Replaces the per-service railway/<svc>/railway.toml Config-as-Code files,
// which Railway stops reading on 2026-12-01.
//
// Railway does NOT read this file on deploy. Changes only take effect via
// `railway config plan` + `railway config apply` (CLI >= 5.42.1).
// Whole-project file: a service missing from `resources` is planned for deletion.
//
// Builds use Railpack. The repo-root railpack.json forces the Python provider
// (the root also has package.json) and copies backend/requirements.txt into
// the install step. Python 3.11 comes from .python-version. The venv is on
// PATH, so `python` is the venv interpreter.
//
// Variables are deliberately unmanaged (`managed: false`): secrets stay in the
// Railway dashboard and this file never adds, changes or deletes them.
import { defineRailway, github, project, service } from "railway/iac";

export default defineRailway(() => {
  const mederti = github("mederti/mederti", { branch: "main", checkSuites: false });

  const cron = (schedule: string) => ({
    cronSchedule: schedule,
    restartPolicyType: "NEVER" as const,
  });
  const build = { builder: "RAILPACK" as const, buildEnvironment: "V3" as const };

  // TGA / FDA / Health Canada, every 4 hours.
  const shortageCronFrequent = service("shortage-cron-frequent", {
    source: mederti,
    build,
    start: "python railway/shortage_cron_frequent/run.py",
    deploy: cron("0 */4 * * *"),
    replicas: { "us-east4-eqdc4a": 1 },
    networking: { privateNetworkEndpoint: "incredible-vibrancy" },
  });

  // All other national shortage scrapers, daily at 02:00 UTC.
  const shortageCronDaily = service("shortage-cron-daily", {
    source: mederti,
    build,
    start: "python railway/shortage_cron_daily/run.py",
    deploy: cron("0 2 * * *"),
    replicas: { "us-east4-eqdc4a": 1 },
  });

  // Recall scrapers, every 6 hours. (Railway-generated service name.)
  const recallCron = service("feisty-imagination", {
    source: github("mederti/mederti", { branch: "main", checkSuites: false, rootDirectory: "/" }),
    build,
    start: "python railway/recall_cron/run.py",
    deploy: cron("0 */6 * * *"),
    replicas: { "us-east4-eqdc4a": 1 },
  });

  return project("disciplined-analysis", {
    variables: { managed: false },
    resources: [shortageCronFrequent, shortageCronDaily, recallCron],
  });
});
