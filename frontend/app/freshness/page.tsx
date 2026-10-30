// Source freshness — per-source, two independent staleness signals.
//
//   Our job     — did Mederti's collector run successfully within cadence?
//   Upstream    — is the regulator still publishing anything new? (suspicion)
//
// Rules live in lib/freshness.ts. The page never calls a source fresh on
// anything but recorded evidence: no last_scraped_at → "never", no observed
// date advance → not "advancing".

import type { Metadata } from "next";
import AppShell from "@/app/components/v1/AppShell";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  buildFreshnessReport,
  fmtAge,
  type FreshnessReport,
  type JobState,
  type SourceFreshness,
  type UpstreamState,
} from "@/lib/freshness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Source freshness — Mederti",
  description:
    "Per-source collection health and upstream publication signals for every regulator Mederti tracks.",
};

const JOB: Record<JobState, { label: string; tone: string }> = {
  on_schedule: { label: "On schedule", tone: "ok" },
  failing:     { label: "Failing", tone: "crit" },
  not_running: { label: "Not running", tone: "crit" },
  never:       { label: "Never succeeded", tone: "crit" },
};

const UPSTREAM: Record<UpstreamState, { label: string; tone: string }> = {
  advancing:       { label: "Advancing", tone: "ok" },
  suspected_stall: { label: "Suspected stall", tone: "med" },
  measuring:       { label: "Measuring", tone: "mute" },
  no_source_dates: { label: "No source dates", tone: "mute" },
  not_measured:    { label: "Not yet measured", tone: "mute" },
  not_assessable:  { label: "Not assessed", tone: "mute" },
};

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";

const fmtDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
        timeZoneName: "short",
      })
    : "—";

const daysOld = (iso: string | null) =>
  iso ? Math.floor((Date.now() - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000) : null;

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

function Row({ s }: { s: SourceFreshness }) {
  const job = JOB[s.job_state];
  const up = UPSTREAM[s.upstream_state];
  const age = daysOld(s.newest_source_date);
  return (
    <tr>
      <td>
        {s.source_url ? (
          <a href={s.source_url} target="_blank" rel="noreferrer" className="code">
            {s.code}
          </a>
        ) : (
          <span className="code">{s.code}</span>
        )}
        <div className="sub">{s.name}</div>
      </td>
      <td>
        <div>{s.country ?? "—"}</div>
        <div className="sub mono">{s.country_code ?? ""}</div>
      </td>
      <td>
        <Pill tone={job.tone}>{job.label}</Pill>
        <div className="sub">
          Last success: <span className="mono">{fmtDateTime(s.last_success_at)}</span>
        </div>
        <div className="sub">{s.job_detail}</div>
        <div className="sub faint">
          Expected every {s.cadence_hours}h
          {s.declared_cadence_hours != null && s.declared_cadence_hours !== s.cadence_hours
            ? ` (declared ${s.declared_cadence_hours}h; 24h minimum applied)`
            : ""}
          {s.recent_failures ? ` · ${s.recent_failures} failed of last ${s.runs_examined} runs` : ""}
        </div>
      </td>
      <td>
        <Pill tone={up.tone}>{up.label}</Pill>
        <div className="sub">
          Newest source date: <span className="mono">{fmtDate(s.newest_source_date)}</span>
          {age != null ? <span className="faint"> ({age}d old)</span> : null}
        </div>
        {s.newest_source_date_basis === "stored_records" ? (
          <div className="sub faint">From stored source-dated records, not per-run tracking.</div>
        ) : null}
        <div className="sub">{s.upstream_detail}</div>
      </td>
    </tr>
  );
}

function Body({ data }: { data: FreshnessReport }) {
  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="n">{data.summary.active}</div>
          <div className="l">Active sources</div>
        </div>
        <div className="stat">
          <div className="n ok">{data.summary.on_schedule}</div>
          <div className="l">Our job on schedule</div>
        </div>
        <div className="stat">
          <div className="n crit">{data.summary.job_stopped}</div>
          <div className="l">Our job stopped or failing</div>
        </div>
        <div className="stat">
          <div className="n med">{data.summary.suspected_upstream_stall}</div>
          <div className="l">Suspected upstream stall</div>
        </div>
      </div>

      {!data.run_tracking_available ? (
        <div className="note">
          Per-run source-date tracking is not live yet (migration 076 pending, or no run since it
          was applied). Until it is, the upstream signal relies only on identical-payload streaks,
          and the newest source date shown comes from stored records.
        </div>
      ) : null}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Country</th>
              <th>Our job</th>
              <th>Upstream</th>
            </tr>
          </thead>
          <tbody>
            {data.sources.map((s) => (
              <Row key={s.id} s={s} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="method">
        <h2>How to read this</h2>
        <p>
          <strong>Our job</strong> compares the last successful collection run with the source&apos;s
          cadence (at least 24h, plus a grace period). <em>Failing</em> means we can see recent
          attempts that failed; <em>not running</em> means there were no attempts at all.
        </p>
        <p>
          <strong>Upstream</strong> asks whether the regulator is still publishing. It is flagged
          as a <em>suspected stall</em> when the fetched payload was byte-identical for{" "}
          {data.stall_runs}+ consecutive runs covering at least {data.stall_runs} collection intervals, or the newest date the source itself published has
          not advanced for {data.stall_runs}+ runs. This is a suspicion, not proof — a quiet register
          may simply have had nothing new to report. Dates on or after the day of a run are
          ignored, because several collectors default a missing date to the run date.{" "}
          <em>Advancing</em> is only shown after a run has actually watched the date move.
        </p>
        <p className="faint">
          Generated {fmtDateTime(data.generated_at)} · cached 5 minutes ·{" "}
          {data.inactive_sources_excluded} inactive source records excluded. Times in UTC.
        </p>
      </div>
    </>
  );
}

export default async function FreshnessPage() {
  let data: FreshnessReport | null = null;
  try {
    data = await buildFreshnessReport(getSupabaseAdmin());
  } catch (err) {
    console.error("freshness page:", err instanceof Error ? err.message : err);
  }
  const stopped = data?.sources.filter((s) => s.job_state !== "on_schedule") ?? [];

  return (
    <AppShell
      contentClassName="flush"
      chat={{
        contextKey: "freshness",
        title: "Source freshness",
        category: "Data freshness",
        bodyText:
          "The user is viewing Mederti's per-source freshness page: for each regulator, whether Mederti's collection job is on schedule, and whether the regulator's own publication appears to have stalled (a suspicion, not proof)." +
          (stopped.length
            ? ` Sources whose job is stopped or failing right now: ${stopped
                .map((s) => `${s.code} (${s.country ?? s.country_code}, last success ${fmtAge(s.hours_since_success)})`)
                .join("; ")}.`
            : ""),
        headerLabel: "Ask about data freshness",
        emptyLead: "Ask how current a country's shortage data is, or why a source is flagged.",
        starters: [
          "Which sources are stale right now?",
          "How fresh is the Canadian data?",
          "What does a suspected upstream stall mean?",
        ],
      }}
    >
      <style>{CSS}</style>
      <div className="fresh">
        <div className="head">
          <h1>Source freshness</h1>
          <p>
            Two separate questions for every regulator we collect from: is <strong>our</strong>{" "}
            collector running, and is the <strong>source</strong> still publishing? All values are
            read live from our run records — nothing here is a claimed cadence.
          </p>
        </div>
        {data ? (
          <Body data={data} />
        ) : (
          <div className="note">Freshness data is unavailable right now. Try again in a minute.</div>
        )}
      </div>
    </AppShell>
  );
}

const CSS = `
.fresh{max-width:1200px;margin:0 auto;padding:28px 24px 64px;color:var(--tx)}
.fresh .head h1{font-size:22px;font-weight:700;margin:0 0 6px;letter-spacing:-.02em}
.fresh .head p{font-size:14px;color:var(--tx-3);margin:0;max-width:720px;line-height:1.55}
.fresh .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:22px 0 16px}
.fresh .stat{background:var(--surf);border:1px solid var(--border);border-radius:var(--r-tile);padding:14px 16px}
.fresh .stat .n{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.03em}
.fresh .stat .n.ok{color:var(--ok)}.fresh .stat .n.crit{color:var(--crit)}.fresh .stat .n.med{color:var(--med)}
.fresh .stat .l{font-size:12px;color:var(--tx-3);margin-top:2px}
.fresh .note{background:var(--med-bg);border:1px solid var(--med-b);color:var(--tx-2);border-radius:var(--r-tile);padding:12px 14px;font-size:13px;margin-bottom:16px;line-height:1.5}
.fresh .tablewrap{overflow-x:auto;border:1px solid var(--border);border-radius:var(--r-tile);background:var(--surf)}
.fresh table{width:100%;border-collapse:collapse;font-size:13px;min-width:760px}
.fresh th{text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--tx-4);background:var(--surf-2);padding:10px 14px;border-bottom:1px solid var(--border)}
.fresh td{padding:12px 14px;border-top:1px solid var(--hair);vertical-align:top}
.fresh td:nth-child(3),.fresh td:nth-child(4){width:34%}
.fresh .code{font-weight:600;color:var(--tx);text-decoration:none}
.fresh a.code:hover{text-decoration:underline}
.fresh .sub{font-size:12px;color:var(--tx-3);margin-top:4px;line-height:1.45}
.fresh .faint{color:var(--tx-4)}
.fresh .mono{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:11.5px}
.fresh .pill{display:inline-block;font-size:11px;font-weight:600;padding:2px 9px;border-radius:var(--r-pill);border:1px solid}
.fresh .pill.ok{color:var(--ok);background:var(--ok-bg);border-color:var(--ok-b)}
.fresh .pill.crit{color:var(--crit);background:var(--crit-bg);border-color:var(--crit-b)}
.fresh .pill.med{color:var(--med);background:var(--med-bg);border-color:var(--med-b)}
.fresh .pill.mute{color:var(--tx-3);background:var(--surf-2);border-color:var(--border)}
.fresh .method{margin-top:28px;max-width:760px}
.fresh .method h2{font-size:15px;font-weight:700;margin:0 0 8px}
.fresh .method p{font-size:13px;color:var(--tx-2);line-height:1.6;margin:0 0 10px}
@media(max-width:720px){
  .fresh{padding:20px 16px 48px}.fresh .stats{grid-template-columns:repeat(2,1fr)}
  .fresh .tablewrap{overflow:visible}
  .fresh table{min-width:0}
  .fresh table,.fresh tbody,.fresh tr,.fresh td{display:block;width:auto!important}
  .fresh thead{display:none}
  .fresh tr{border-top:1px solid var(--hair);padding:8px 0}
  .fresh tr:first-child{border-top:none}
  .fresh td{border-top:none;padding:6px 14px}
  .fresh td:nth-child(2){display:flex;gap:6px;align-items:baseline}
  .fresh td:nth-child(2) .sub{margin-top:0}
  .fresh td:nth-child(3)::before,.fresh td:nth-child(4)::before{display:block;font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--tx-4);margin-bottom:4px}
  .fresh td:nth-child(3)::before{content:"Our job"}
  .fresh td:nth-child(4)::before{content:"Upstream"}
}
`;
