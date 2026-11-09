// Per-source data freshness — two independent staleness signals.
//
//   1. Our job stopped  — the last successful run (data_sources.last_scraped_at,
//      written by every non-failed scraper run) is older than the source's
//      cadence. Split into "failing" (we can see recent failed attempts in
//      raw_scrapes / last_run_status) vs "not running" (no attempts at all —
//      laptop asleep, cron line missing).
//   2. Upstream stale   — our job runs, but what the source publishes has not
//      moved for STALL_RUNS consecutive runs. Evidence is either:
//        a. raw_scrapes status 'duplicate' streak: the fetched payload was
//           byte-identical to one already processed (available today), or
//        b. data_sources.newest_source_date_unchanged_runs (migration 076):
//           the newest date the source itself published has not advanced.
//      Always a SUSPICION — a quiet register legitimately publishes nothing.
//
// Nothing is reported as fresh unless the data proves it: "on schedule" needs
// a real last_scraped_at inside the window, and "advancing" needs a run that
// watched the source date move (first_seen_at set — never the baseline).
//
// Row-cap safe: one data_sources read (<100 rows) plus small per-source
// queries (limit ≤ 15), never a scan of raw_scrapes or shortage_events.

import type { SupabaseClient } from "@supabase/supabase-js";

export const STALL_RUNS = 7;
const RUN_HISTORY = 40;
const MIN_CADENCE_HOURS = 24; // most sources run once a day; a shorter declared cadence would misfire

export type JobState = "on_schedule" | "failing" | "not_running" | "never";
export type UpstreamState =
  | "advancing"
  | "suspected_stall"
  | "measuring"
  | "no_source_dates"
  | "not_measured"
  | "not_assessable";

export type SourceFreshness = {
  id: string;
  code: string;
  name: string;
  country: string | null;
  country_code: string | null;
  region: string | null;
  source_url: string | null;

  // Signal 1 — our job
  cadence_hours: number;
  declared_cadence_hours: number | null;
  overdue_after_hours: number;
  last_success_at: string | null;
  hours_since_success: number | null;
  last_attempt_at: string | null;
  last_attempt_status: string | null;
  recent_failures: number; // failed runs among the last `runs_examined`
  runs_examined: number;
  job_state: JobState;
  job_detail: string;

  // Signal 2 — upstream
  newest_source_date: string | null;
  newest_source_date_basis: "tracked_runs" | "stored_records" | null;
  newest_source_date_advanced_at: string | null;
  unchanged_runs: number | null; // migration 076 streak
  identical_payload_runs: number; // raw_scrapes duplicate streak
  // Finish of the last run whose payload DID change; null if the streak runs
  // past the fetched history (then it is at least identical_payload_runs).
  payload_last_changed_at: string | null;
  upstream_state: UpstreamState;
  upstream_detail: string;
};

export type FreshnessReport = {
  generated_at: string;
  stall_runs: number;
  run_tracking_available: boolean; // migration 076 applied?
  inactive_sources_excluded: number;
  summary: {
    active: number;
    on_schedule: number;
    job_stopped: number; // failing + not_running + never
    suspected_upstream_stall: number;
  };
  sources: SourceFreshness[];
};

type SourceRow = {
  id: string;
  abbreviation: string;
  name: string;
  country: string | null;
  country_code: string | null;
  region: string | null;
  source_url: string | null;
  scrape_frequency_hours: number | null;
  last_scraped_at: string | null;
  is_active: boolean;
  last_run_at?: string | null;
  last_run_status?: string | null;
  newest_source_date?: string | null;
  newest_source_date_first_seen_at?: string | null;
  newest_source_date_unchanged_runs?: number | null;
};

type RunRow = { status: string; scraped_at: string };

const BASE_COLS =
  "id,abbreviation,name,country,country_code,region,source_url,scrape_frequency_hours,last_scraped_at,is_active";
const RUN_COLS =
  "last_run_at,last_run_status,newest_source_date,newest_source_date_first_seen_at,newest_source_date_unchanged_runs";

const hoursSince = (iso: string | null | undefined, now: number): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (now - t) / 3_600_000 : null;
};

export function fmtAge(hours: number | null): string {
  if (hours == null) return "never";
  if (hours < 1) return "under an hour ago";
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

/** Pure classification — exported for tests. */
export function classify(
  s: SourceRow,
  runs: RunRow[],
  storedNewestDate: string | null,
  runTracking: boolean,
  now: number,
): SourceFreshness {
  const declared = s.scrape_frequency_hours ?? null;
  const cadence = Math.max(declared ?? MIN_CADENCE_HOURS, MIN_CADENCE_HOURS);
  const overdueAfter = cadence + Math.max(12, Math.round(cadence * 0.25));

  const lastSuccessH = hoursSince(s.last_scraped_at, now);

  // Latest attempt: newest of raw_scrapes and last_run_at (recall scrapers
  // don't write raw_scrapes; pre-076 nothing writes last_run_at).
  let lastAttemptAt: string | null = runs[0]?.scraped_at ?? null;
  let lastAttemptStatus: string | null = runs[0]?.status ?? null;
  if (s.last_run_at && (!lastAttemptAt || Date.parse(s.last_run_at) > Date.parse(lastAttemptAt))) {
    lastAttemptAt = s.last_run_at;
    lastAttemptStatus = s.last_run_status ?? null;
  }
  const lastAttemptH = hoursSince(lastAttemptAt, now);
  const recentFailures = runs.filter((r) => r.status === "failed").length;

  let job: JobState;
  let jobDetail: string;
  if (lastSuccessH == null) {
    job = "never";
    jobDetail =
      lastAttemptAt && lastAttemptStatus === "failed"
        ? `No successful run on record; last attempt failed ${fmtAge(lastAttemptH)}.`
        : "No successful run on record.";
  } else if (lastSuccessH > overdueAfter) {
    const attemptedSince =
      lastAttemptH != null && lastAttemptH < lastSuccessH && lastAttemptH <= overdueAfter;
    if (attemptedSince && lastAttemptStatus === "failed") {
      job = "failing";
      jobDetail = `Runs but fails — last success ${fmtAge(lastSuccessH)}, last attempt failed ${fmtAge(lastAttemptH)}.`;
    } else {
      job = "not_running";
      jobDetail = `No run since ${fmtAge(lastSuccessH)} (expected every ${cadence}h).`;
    }
  } else {
    job = "on_schedule";
    jobDetail =
      lastAttemptStatus === "failed" && lastAttemptH != null && lastAttemptH < lastSuccessH
        ? `Last success ${fmtAge(lastSuccessH)}; most recent attempt failed.`
        : `Last success ${fmtAge(lastSuccessH)}.`;
  }

  // Identical-payload streak: most recent non-failed runs that were 'duplicate'.
  let identical = 0;
  let lastChangedAt: string | null = null;
  let oldestIdenticalAt: string | null = null;
  for (const r of runs) {
    if (r.status === "failed") continue;
    if (r.status !== "duplicate") {
      lastChangedAt = r.scraped_at;
      break;
    }
    identical++;
    oldestIdenticalAt = r.scraped_at;
  }
  // N identical runs must also cover N cadence intervals: FDA runs several
  // times a day, and 14 identical runs there is two quiet days, not a stall.
  const identicalSpanH = hoursSince(lastChangedAt ?? oldestIdenticalAt, now) ?? 0;
  const identicalStall = identical >= STALL_RUNS && identicalSpanH >= STALL_RUNS * cadence;

  const tracked = runTracking && s.newest_source_date ? s.newest_source_date : null;
  const unchanged = runTracking ? s.newest_source_date_unchanged_runs ?? 0 : null;
  const advancedAt = runTracking ? s.newest_source_date_first_seen_at ?? null : null;
  const newestDate = tracked ?? storedNewestDate;
  const basis = tracked ? "tracked_runs" : storedNewestDate ? "stored_records" : null;
  // Same span rule for the date streak. With a real advance on record we can
  // time it; for the first-run baseline, scale the run count by how many runs
  // the declared cadence fits into one interval (FDA: 6h → 4 per day).
  const runsPerInterval = Math.max(1, Math.round(cadence / Math.max(declared ?? cadence, 1)));
  const trackedStall =
    !!tracked &&
    (unchanged ?? 0) >= STALL_RUNS &&
    (advancedAt
      ? (hoursSince(advancedAt, now) ?? 0) >= STALL_RUNS * cadence
      : (unchanged ?? 0) >= STALL_RUNS * runsPerInterval);

  let up: UpstreamState;
  let upDetail: string;
  if (job !== "on_schedule") {
    up = "not_assessable";
    upDetail = "Can't judge the source while our own job isn't running successfully.";
  } else if (identicalStall || trackedStall) {
    up = "suspected_stall";
    const parts: string[] = [];
    if (trackedStall)
      parts.push(`newest source date hasn't advanced in ${unchanged} runs`);
    if (identicalStall)
      parts.push(
        `payload byte-identical for ${identical}${lastChangedAt ? "" : "+"} consecutive runs` +
          (lastChangedAt ? ` (last changed ${fmtAge(hoursSince(lastChangedAt, now))})` : ""),
      );
    upDetail = `Suspected: ${parts.join("; ")}. May simply mean no new notices.`;
  } else if (tracked && advancedAt) {
    up = "advancing";
    upDetail = `Source date last advanced ${fmtAge(hoursSince(advancedAt, now))}.`;
  } else if (tracked) {
    up = "measuring";
    upDetail = `Baseline recorded; no advance observed yet (${unchanged ?? 0} of ${STALL_RUNS} runs).`;
  } else if (runTracking && s.last_run_at) {
    up = "no_source_dates";
    upDetail = identical
      ? `Source publishes no usable dates; payload identical for ${identical} run(s).`
      : "Source publishes no usable dates to track.";
  } else {
    up = "not_measured";
    upDetail = identical
      ? `Per-run date tracking not live yet; payload identical for ${identical} run(s).`
      : "Per-run date tracking not live yet; payload changed on the latest run.";
  }

  return {
    id: s.id,
    code: s.abbreviation,
    name: s.name,
    country: s.country,
    country_code: s.country_code,
    region: s.region,
    source_url: s.source_url,
    cadence_hours: cadence,
    declared_cadence_hours: declared,
    overdue_after_hours: overdueAfter,
    last_success_at: s.last_scraped_at,
    hours_since_success: lastSuccessH == null ? null : Math.round(lastSuccessH * 10) / 10,
    last_attempt_at: lastAttemptAt,
    last_attempt_status: lastAttemptStatus,
    recent_failures: recentFailures,
    runs_examined: runs.length,
    job_state: job,
    job_detail: jobDetail,
    newest_source_date: newestDate,
    newest_source_date_basis: basis,
    newest_source_date_advanced_at: advancedAt,
    unchanged_runs: unchanged,
    identical_payload_runs: identical,
    payload_last_changed_at: lastChangedAt,
    upstream_state: up,
    upstream_detail: upDetail,
  };
}

export async function buildFreshnessReport(sb: SupabaseClient): Promise<FreshnessReport> {
  const now = Date.now();

  // Prefer the migration-076 columns; fall back if they don't exist yet.
  let runTracking = true;
  let res = await sb.from("data_sources").select(`${BASE_COLS},${RUN_COLS}`);
  if (res.error) {
    runTracking = false;
    res = await sb.from("data_sources").select(BASE_COLS);
  }
  if (res.error) throw new Error(res.error.message);

  const all = (res.data ?? []) as unknown as SourceRow[];
  const active = all.filter((s) => s.is_active);
  // A pre-076 deploy would also leave every last_run_at NULL; treat "applied
  // but no run yet" the same as "not applied" for the upstream wording.
  if (runTracking && !active.some((s) => s.last_run_at)) runTracking = false;

  const today = new Date(now).toISOString().slice(0, 10);

  const rows = await mapLimit(active, 12, async (s) => {
    const [runsRes, storedRes] = await Promise.all([
      sb
        .from("raw_scrapes")
        .select("status,scraped_at")
        .eq("data_source_id", s.id)
        .order("scraped_at", { ascending: false })
        .limit(RUN_HISTORY),
      // Fallback "newest source date" for display only: the newest stored
      // shortage whose start_date came from the source (not carried forward,
      // not a first-seen default) and is before today. Never drives "advancing".
      runTracking && s.newest_source_date
        ? Promise.resolve({ data: null })
        : sb
            .from("shortage_events")
            .select("start_date")
            .eq("data_source_id", s.id)
            .eq("raw_data->>start_date_basis", "source")
            .lt("start_date", today)
            .order("start_date", { ascending: false })
            .limit(1),
    ]);
    const runs = ((runsRes as { data: RunRow[] | null }).data ?? []) as RunRow[];
    const stored =
      ((storedRes as { data: { start_date: string }[] | null }).data ?? [])[0]?.start_date ?? null;
    return classify(s, runs, stored, runTracking, now);
  });

  const order: Record<JobState, number> = { never: 0, not_running: 1, failing: 2, on_schedule: 3 };
  rows.sort(
    (a, b) =>
      order[a.job_state] - order[b.job_state] ||
      Number(b.upstream_state === "suspected_stall") - Number(a.upstream_state === "suspected_stall") ||
      (a.country ?? "").localeCompare(b.country ?? "") ||
      a.code.localeCompare(b.code),
  );

  return {
    generated_at: new Date(now).toISOString(),
    stall_runs: STALL_RUNS,
    run_tracking_available: runTracking,
    inactive_sources_excluded: all.length - active.length,
    summary: {
      active: rows.length,
      on_schedule: rows.filter((r) => r.job_state === "on_schedule").length,
      job_stopped: rows.filter((r) => r.job_state !== "on_schedule").length,
      suspected_upstream_stall: rows.filter((r) => r.upstream_state === "suspected_stall").length,
    },
    sources: rows,
  };
}
