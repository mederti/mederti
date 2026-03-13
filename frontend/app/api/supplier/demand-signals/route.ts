import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BATCH = 1000;

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    const now = Date.now();
    const d7 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const d14 = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
    const d30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch recent shortage_events (last 30 days, paginated)
    const recentRows: Record<string, unknown>[] = [];
    let offset = 0;

    while (true) {
      const { data: batch } = await supabase
        .from("shortage_events")
        .select("drug_id, country_code, severity, created_at")
        .in("status", ["active", "anticipated"])
        .gte("created_at", d30)
        .range(offset, offset + BATCH - 1);

      const rows = batch ?? [];
      recentRows.push(...rows);
      if (rows.length < BATCH) break;
      offset += BATCH;
    }

    // Compute KPIs
    let newLast7d = 0;
    let newPrior7d = 0;

    const drugSignals = new Map<string, {
      drug_id: string;
      events_7d: number;
      events_30d: number;
      max_severity: string;
      countries: Set<string>;
    }>();

    const SEV_ORDER = ["critical", "high", "medium", "low"];

    for (const row of recentRows) {
      const drugId = row.drug_id as string;
      const createdAt = row.created_at as string;
      const sev = ((row.severity as string) ?? "low").toLowerCase();
      const cc = (row.country_code as string) ?? "XX";

      const isLast7d = createdAt >= d7;
      const isPrior7d = createdAt >= d14 && createdAt < d7;

      if (isLast7d) newLast7d++;
      if (isPrior7d) newPrior7d++;

      if (!drugSignals.has(drugId)) {
        drugSignals.set(drugId, {
          drug_id: drugId,
          events_7d: 0,
          events_30d: 0,
          max_severity: "low",
          countries: new Set(),
        });
      }

      const entry = drugSignals.get(drugId)!;
      entry.events_30d++;
      if (isLast7d) entry.events_7d++;
      entry.countries.add(cc);
      if (SEV_ORDER.indexOf(sev) < SEV_ORDER.indexOf(entry.max_severity)) {
        entry.max_severity = sev;
      }
    }

    const accelerationPct = newPrior7d > 0
      ? Math.round(((newLast7d - newPrior7d) / newPrior7d) * 100)
      : newLast7d > 0 ? 100 : 0;

    // Sort by 7d events desc, then 30d
    const trending = [...drugSignals.values()]
      .sort((a, b) => b.events_7d - a.events_7d || b.events_30d - a.events_30d)
      .slice(0, 15);

    // Fetch drug names
    const trendIds = trending.map((t) => t.drug_id);
    const { data: drugs } = await supabase
      .from("drugs")
      .select("id, generic_name")
      .in("id", trendIds.length > 0 ? trendIds : ["__none__"]);

    const nameMap = new Map((drugs ?? []).map((d: { id: string; generic_name: string }) => [d.id, d.generic_name]));

    return NextResponse.json({
      kpis: {
        new_last_7d: newLast7d,
        new_prior_7d: newPrior7d,
        acceleration_pct: accelerationPct,
        new_last_30d: recentRows.length,
      },
      trending: trending.map((t) => ({
        drug_id: t.drug_id,
        drug_name: nameMap.get(t.drug_id) ?? "Unknown",
        new_events_7d: t.events_7d,
        new_events_30d: t.events_30d,
        max_severity: t.max_severity,
        countries: [...t.countries],
      })),
    });
  } catch (err) {
    console.error("supplier/demand-signals error:", err);
    return NextResponse.json(
      { kpis: { new_last_7d: 0, new_prior_7d: 0, acceleration_pct: 0, new_last_30d: 0 }, trending: [], error: "Failed to fetch demand signals" },
      { status: 500 },
    );
  }
}
