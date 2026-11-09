import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { buildFreshnessReport } from "@/lib/freshness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Cache 5 minutes — freshness data only changes when scrapers run.
export const revalidate = 300;

/**
 * GET /api/freshness
 *
 * Per-source freshness with two independent staleness signals — see
 * lib/freshness.ts for the rules:
 *
 *   job_state       on_schedule | failing | not_running | never
 *                   ("our job stopped": last successful run vs cadence)
 *   upstream_state  advancing | suspected_stall | measuring | no_source_dates
 *                   | not_measured | not_assessable
 *                   ("upstream stale": source output unchanged for
 *                   `stall_runs` consecutive runs — a suspicion, not proof)
 *
 * Active data_sources only. Each source also carries its country, last
 * successful run, latest attempt + status, and newest source-reported date
 * with its basis ("tracked_runs" from migration 076, or "stored_records").
 */
export async function GET() {
  try {
    const report = await buildFreshnessReport(getSupabaseAdmin());
    return NextResponse.json(report, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    console.error("freshness error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
