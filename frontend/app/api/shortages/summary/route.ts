import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// Closes audit FINDING-B3-05 (full fix). Restores /home's headline numbers
// (active total, new-this-month, resolved-this-month, by-country chart) —
// previously called api.getSummary() which hit a non-existent route.
//
// 5-minute edge cache. The aggregations span ~21k shortage rows so each
// cold run takes ~600 ms; users hitting /home in any 5-min window after
// the first re-use the same payload essentially free.
export const revalidate = 300;

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const RANK_TO_SEV: Record<number, string> = { 4: "critical", 3: "high", 2: "medium", 1: "low" };

// ISO-2 → display name for the top countries we cover. Anything not in
// this map renders as the ISO-2 code itself.
const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia", US: "United States", GB: "United Kingdom", CA: "Canada",
  DE: "Germany", FR: "France", IT: "Italy", ES: "Spain", NL: "Netherlands",
  BE: "Belgium", IE: "Ireland", PT: "Portugal", GR: "Greece", AT: "Austria",
  CH: "Switzerland", FI: "Finland", NO: "Norway", SE: "Sweden", DK: "Denmark",
  NZ: "New Zealand", SG: "Singapore", HK: "Hong Kong", JP: "Japan",
  KR: "South Korea", BR: "Brazil", MX: "Mexico", AR: "Argentina",
  ZA: "South Africa", NG: "Nigeria", SA: "Saudi Arabia", AE: "UAE",
  TR: "Turkey", PL: "Poland", HU: "Hungary", CZ: "Czech Republic",
  MY: "Malaysia", IN: "India", CN: "China",
};

type ActiveRow = {
  country_code: string | null;
  severity: string | null;
  reason_category: string | null;
};

export async function GET() {
  const sb = getSupabaseAdmin();

  // Pull every active row with the 3 columns needed for aggregation. ~15k
  // rows today; ~30 ms over the wire from the same Vercel region. Could
  // be replaced with a Postgres view later (FINDING-P5-02 pattern); keeping
  // it inline keeps the migration footprint of this fix to zero.
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const [activeRes, newRes, resolvedRes] = await Promise.all([
    sb.from("shortage_events")
      .select("country_code, severity, reason_category")
      .eq("status", "active"),
    sb.from("shortage_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", monthAgo),
    sb.from("shortage_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "resolved")
      .gte("end_date", monthAgo.slice(0, 10)),
  ]);

  if (activeRes.error) {
    console.error("[/api/shortages/summary] active query failed:", activeRes.error.message);
    return NextResponse.json({ error: "summary failed" }, { status: 500 });
  }

  const active = (activeRes.data ?? []) as ActiveRow[];

  // ── by_severity ──────────────────────────────────────────────────────
  const by_severity: Record<string, number> = {};
  for (const r of active) {
    const sev = r.severity ?? "unknown";
    by_severity[sev] = (by_severity[sev] ?? 0) + 1;
  }

  // ── by_category — count + max severity per reason_category ───────────
  const catCounts = new Map<string, { count: number; max_sev_rank: number }>();
  for (const r of active) {
    const cat = r.reason_category ?? "uncategorised";
    const existing = catCounts.get(cat) ?? { count: 0, max_sev_rank: 0 };
    existing.count += 1;
    const rank = SEV_RANK[r.severity ?? ""] ?? 0;
    if (rank > existing.max_sev_rank) existing.max_sev_rank = rank;
    catCounts.set(cat, existing);
  }
  const by_category = [...catCounts.entries()]
    .map(([category, v]) => ({
      category,
      count: v.count,
      max_severity: RANK_TO_SEV[v.max_sev_rank] ?? "low",
    }))
    .sort((a, b) => b.count - a.count);

  // ── by_country — count + max severity + display name ─────────────────
  const countryCounts = new Map<string, { count: number; max_sev_rank: number }>();
  for (const r of active) {
    const cc = (r.country_code ?? "").toUpperCase();
    if (!cc) continue;
    const existing = countryCounts.get(cc) ?? { count: 0, max_sev_rank: 0 };
    existing.count += 1;
    const rank = SEV_RANK[r.severity ?? ""] ?? 0;
    if (rank > existing.max_sev_rank) existing.max_sev_rank = rank;
    countryCounts.set(cc, existing);
  }
  const by_country = [...countryCounts.entries()]
    .map(([country_code, v]) => ({
      country_code,
      country: COUNTRY_NAMES[country_code] ?? country_code,
      count: v.count,
      max_severity: RANK_TO_SEV[v.max_sev_rank] ?? "low",
    }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    by_severity,
    by_category,
    by_country,
    total_active: active.length,
    new_this_month: newRes.count ?? 0,
    resolved_this_month: resolvedRes.count ?? 0,
  });
}
