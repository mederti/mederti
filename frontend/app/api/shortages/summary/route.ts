import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const SEV_ORDER = ["critical", "high", "medium", "low"];

export async function GET() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // 1. All active/anticipated events (paginated to avoid 1000-row cap)
  const BATCH = 1000;
  const allRows: Record<string, unknown>[] = [];
  let offset = 0;

  while (true) {
    const { data: batch } = await getSupabaseAdmin()
      .from("shortage_events")
      .select("severity, reason_category, country_code, country")
      .in("status", ["active", "anticipated"])
      .range(offset, offset + BATCH - 1);

    const rows = batch ?? [];
    allRows.push(...rows);
    if (rows.length < BATCH) break;
    offset += BATCH;
  }

  const bySeverity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const byCategoryMap: Record<string, { count: number; max_severity: string }> = {};
  const byCountryMap: Record<string, { country: string; count: number; max_severity: string }> = {};

  for (const row of allRows) {
    const sev = ((row.severity as string) ?? "low").toLowerCase();
    if (sev in bySeverity) bySeverity[sev]++;

    const cat = (row.reason_category as string) ?? "Other";
    if (!byCategoryMap[cat]) byCategoryMap[cat] = { count: 0, max_severity: "low" };
    byCategoryMap[cat].count++;

    const cc = (row.country_code as string) ?? "XX";
    const countryName = (row.country as string) ?? cc;
    if (!byCountryMap[cc]) byCountryMap[cc] = { country: countryName, count: 0, max_severity: "low" };
    byCountryMap[cc].count++;

    if (SEV_ORDER.includes(sev)) {
      for (const bucket of [byCategoryMap[cat], byCountryMap[cc]]) {
        if (SEV_ORDER.indexOf(sev) < SEV_ORDER.indexOf(bucket.max_severity)) {
          bucket.max_severity = sev;
        }
      }
    }
  }

  const byCountry = Object.entries(byCountryMap)
    .filter(([cc]) => cc !== "XX")
    .map(([cc, data]) => ({
      country_code: cc,
      country: data.country,
      count: data.count,
      max_severity: data.max_severity,
    }))
    .sort((a, b) => b.count - a.count);

  const byCategory = Object.entries(byCategoryMap)
    .map(([cat, data]) => ({
      category: cat,
      count: data.count,
      max_severity: data.max_severity,
    }))
    .sort((a, b) => SEV_ORDER.indexOf(a.max_severity) - SEV_ORDER.indexOf(b.max_severity) || b.count - a.count)
    .slice(0, 15);

  // 2. New this month
  const { count: newThisMonth } = await getSupabaseAdmin()
    .from("shortage_events")
    .select("id", { count: "exact", head: true })
    .in("status", ["active", "anticipated"])
    .gte("created_at", cutoff);

  // 3. Resolved this month
  const { count: resolvedThisMonth } = await getSupabaseAdmin()
    .from("shortage_events")
    .select("id", { count: "exact", head: true })
    .eq("status", "resolved")
    .gte("last_verified_at", cutoff);

  return NextResponse.json({
    by_severity: bySeverity,
    by_category: byCategory,
    by_country: byCountry,
    total_active: allRows.length,
    new_this_month: newThisMonth ?? 0,
    resolved_this_month: resolvedThisMonth ?? 0,
  });
}
