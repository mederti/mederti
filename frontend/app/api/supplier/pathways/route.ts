import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia", US: "United States", GB: "United Kingdom", CA: "Canada",
  DE: "Germany", FR: "France", IT: "Italy", ES: "Spain", EU: "EU",
  NZ: "New Zealand", SG: "Singapore", IE: "Ireland", NO: "Norway",
  FI: "Finland", CH: "Switzerland", SE: "Sweden", AT: "Austria",
  BE: "Belgium", NL: "Netherlands", JP: "Japan", DK: "Denmark",
  PT: "Portugal", PL: "Poland", CZ: "Czechia", HU: "Hungary",
};

const BATCH = 1000;

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    // 1. Fetch active regulatory data sources
    const { data: sources } = await supabase
      .from("data_sources")
      .select("id, name, country_code, url, source_type, is_active")
      .eq("is_active", true)
      .order("name");

    if (!sources || sources.length === 0) {
      return NextResponse.json({ pathways: [] });
    }

    // 2. Fetch all active shortage_events to count per country (paginated)
    const shortageRows: Record<string, unknown>[] = [];
    let offset = 0;

    while (true) {
      const { data: batch } = await supabase
        .from("shortage_events")
        .select("country_code, severity")
        .in("status", ["active", "anticipated"])
        .range(offset, offset + BATCH - 1);

      const rows = batch ?? [];
      shortageRows.push(...rows);
      if (rows.length < BATCH) break;
      offset += BATCH;
    }

    // Count per country
    const countryStats = new Map<string, { active: number; critical: number }>();
    for (const row of shortageRows) {
      const cc = (row.country_code as string) ?? "XX";
      if (!countryStats.has(cc)) countryStats.set(cc, { active: 0, critical: 0 });
      const entry = countryStats.get(cc)!;
      entry.active++;
      if (((row.severity as string) ?? "").toLowerCase() === "critical") entry.critical++;
    }

    // 3. Build pathways — one per source
    const pathways = sources.map((s: {
      name: string; country_code: string | null; url: string; source_type: string | null;
    }) => {
      const cc = s.country_code ?? "XX";
      const stats = countryStats.get(cc) ?? { active: 0, critical: 0 };
      return {
        country_code: cc,
        country_name: COUNTRY_NAMES[cc] ?? cc,
        regulatory_body: s.name,
        source_url: s.url,
        source_type: s.source_type ?? "regulatory",
        active_shortage_count: stats.active,
        critical_shortage_count: stats.critical,
      };
    });

    // Sort by active shortage count descending
    pathways.sort((a: { active_shortage_count: number }, b: { active_shortage_count: number }) =>
      b.active_shortage_count - a.active_shortage_count
    );

    return NextResponse.json({ pathways });
  } catch (err) {
    console.error("supplier/pathways error:", err);
    return NextResponse.json({ pathways: [], error: "Failed to fetch pathways" }, { status: 500 });
  }
}
