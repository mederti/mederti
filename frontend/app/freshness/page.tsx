// Public freshness dashboard — credibility lever for "world's leading source"
// positioning per audit §12 open #5.
//
// Lists every regulator Mederti scrapes, the last_scraped_at timestamp, the
// honest freshness label (matches what the chat surfaces in <sources> chips),
// and a reliability weight. Stale sources are visually flagged.

import { Suspense } from "react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 300;

type Regulator = {
  code: string;
  name: string;
  country_code: string;
  region: string | null;
  last_scraped_at: string | null;
  hours_since_scrape: number | null;
  is_stale: boolean;
  freshness_label: string;
  reliability_weight: number | null;
  scrape_frequency_hours: number | null;
  is_active: boolean;
  source_url: string | null;
};

type FreshnessResponse = {
  generated_at: string;
  stale_threshold_hours: number;
  regulators: Regulator[];
  summary: { total: number; active: number; stale: number; fresh_today: number };
};

async function fetchFreshness(): Promise<FreshnessResponse | null> {
  // Server-side fetch against same-origin /api/freshness. Use NEXT_PUBLIC_*
  // base URL when running in Vercel; fall back to localhost in dev.
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  try {
    const res = await fetch(`${base}/api/freshness`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return (await res.json()) as FreshnessResponse;
  } catch {
    return null;
  }
}

function FreshnessBadge({ reg }: { reg: Regulator }) {
  if (!reg.is_active) {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">inactive</span>;
  }
  if (reg.is_stale) {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700">stale</span>;
  }
  if (reg.hours_since_scrape != null && reg.hours_since_scrape < 24) {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">fresh</span>;
  }
  return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">ok</span>;
}

function FreshnessTable({ data }: { data: FreshnessResponse }) {
  // Sort: active first, then by region, then by code
  const sorted = [...data.regulators].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    if ((a.region ?? "") !== (b.region ?? "")) return (a.region ?? "").localeCompare(b.region ?? "");
    return a.code.localeCompare(b.code);
  });
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="text-left px-4 py-3 font-medium">Regulator</th>
            <th className="text-left px-4 py-3 font-medium">Country</th>
            <th className="text-left px-4 py-3 font-medium">Last scraped</th>
            <th className="text-left px-4 py-3 font-medium">Freshness</th>
            <th className="text-right px-4 py-3 font-medium">Reliability</th>
            <th className="text-right px-4 py-3 font-medium">Cadence</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={`${r.code}-${r.country_code}`} className="border-t border-slate-100">
              <td className="px-4 py-3">
                {r.source_url ? (
                  <a className="text-slate-900 hover:underline font-medium" href={r.source_url} target="_blank" rel="noreferrer">
                    {r.code}
                  </a>
                ) : (
                  <span className="text-slate-900 font-medium">{r.code}</span>
                )}
                <div className="text-xs text-slate-500">{r.name}</div>
              </td>
              <td className="px-4 py-3 text-slate-700 tabular-nums">{r.country_code}</td>
              <td className="px-4 py-3 text-slate-700 tabular-nums">{r.freshness_label}</td>
              <td className="px-4 py-3">
                <FreshnessBadge reg={r} />
              </td>
              <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                {r.reliability_weight != null ? r.reliability_weight.toFixed(2) : "—"}
              </td>
              <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                {r.scrape_frequency_hours != null ? `${r.scrape_frequency_hours}h` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function FreshnessPage() {
  const data = await fetchFreshness();

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-slate-900">Source freshness</h1>
        <p className="mt-2 text-slate-600 max-w-2xl">
          Mederti scrapes every regulator on this list daily. The timestamps below are{" "}
          <strong>not</strong> claimed cadences — they're the real{" "}
          <code className="px-1 py-0.5 bg-slate-100 rounded text-xs">last_scraped_at</code> values
          from the database. Sources past our 7-day stale threshold are flagged in red.
        </p>
      </div>

      {!data ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          Freshness data is unavailable right now. Try again in a minute.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs uppercase tracking-wider text-slate-500">Total regulators</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{data.summary.total}</div>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs uppercase tracking-wider text-slate-500">Active</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{data.summary.active}</div>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs uppercase tracking-wider text-slate-500">Fresh today</div>
              <div className="mt-1 text-2xl font-semibold text-emerald-700 tabular-nums">{data.summary.fresh_today}</div>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs uppercase tracking-wider text-slate-500">Stale</div>
              <div className="mt-1 text-2xl font-semibold text-red-700 tabular-nums">{data.summary.stale}</div>
            </div>
          </div>

          <Suspense fallback={<div className="text-slate-500">Loading…</div>}>
            <FreshnessTable data={data} />
          </Suspense>

          <div className="mt-6 text-xs text-slate-500 max-w-3xl">
            Generated {new Date(data.generated_at).toLocaleString()}. Cached 5 minutes.
            The stale threshold is {Math.round(data.stale_threshold_hours / 24)} days — past this,
            shortage data from that regulator is excluded from default chat answers and the source
            chip carries an explicit "stale" flag. The reliability weight is the per-source factor
            used by Mederti's confidence calibration (0–1, higher is more trustworthy).
          </div>
        </>
      )}
    </main>
  );
}
