import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/security/rate-limit";

// Per-country anticipated-vs-active status breakdown.
//
// Answers "how much forward-looking (anticipated) early-warning signal do we
// actually hold, per country, vs in-progress (active) shortages?" — the audit
// deliverable behind migration 049. Reads the v_shortage_status_by_country
// view (FILTER-aggregate pivot, single scan; excludes synthetic recall rows).
//
// 5-minute edge cache. Counts move at scraper cadence (hours), so staleness
// of a few minutes is invisible and this keeps an aggregate scan off the hot
// path. Optional ?country=AU narrows to one country_code.
export const revalidate = 300;

type BreakdownRow = {
  country: string | null;
  country_code: string | null;
  active: number | null;
  anticipated: number | null;
  resolved: number | null;
  stale: number | null;
  live_total: number | null;
  total: number | null;
  next_anticipated_start: string | null;
};

export async function GET(req: NextRequest) {
  const limited = await enforceRateLimit(req, "browse");
  if (limited) return limited;

  const country = new URL(req.url).searchParams.get("country");

  // Untyped client — v_shortage_status_by_country is a view, not in the
  // generated DB types. We shape the rows ourselves below.
  const sb = getSupabaseAdmin();
  let query = sb
    .from("v_shortage_status_by_country")
    .select("*")
    .order("anticipated", { ascending: false });

  if (country) query = query.eq("country_code", country.toUpperCase());

  const { data, error } = await query;
  if (error) {
    console.error("[/api/shortages/status-breakdown] supabase error:", error.message);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as BreakdownRow[];

  const countries = rows.map((r) => ({
    country: r.country ?? "",
    country_code: r.country_code ?? "",
    active: r.active ?? 0,
    anticipated: r.anticipated ?? 0,
    resolved: r.resolved ?? 0,
    stale: r.stale ?? 0,
    live_total: r.live_total ?? 0,
    total: r.total ?? 0,
    next_anticipated_start: r.next_anticipated_start,
  }));

  // Roll the per-country rows up into a single global tally so callers don't
  // have to re-sum client-side.
  const totals = countries.reduce(
    (acc, c) => ({
      active: acc.active + c.active,
      anticipated: acc.anticipated + c.anticipated,
      resolved: acc.resolved + c.resolved,
      stale: acc.stale + c.stale,
      live_total: acc.live_total + c.live_total,
      total: acc.total + c.total,
    }),
    { active: 0, anticipated: 0, resolved: 0, stale: 0, live_total: 0, total: 0 },
  );

  return NextResponse.json({ totals, countries });
}
