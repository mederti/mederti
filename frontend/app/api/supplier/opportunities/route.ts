import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const SEV_ORDER = ["critical", "high", "medium", "low"];
const BATCH = 1000;

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    // Fetch all active shortage_events with critical/high severity (paginated)
    const allRows: Record<string, unknown>[] = [];
    let offset = 0;

    while (true) {
      const { data: batch } = await supabase
        .from("shortage_events")
        .select("drug_id, country_code, severity, reported_date")
        .in("status", ["active", "anticipated"])
        .in("severity", ["critical", "high"])
        .range(offset, offset + BATCH - 1);

      const rows = batch ?? [];
      allRows.push(...rows);
      if (rows.length < BATCH) break;
      offset += BATCH;
    }

    // Group by drug_id
    const drugMap = new Map<string, {
      drug_id: string;
      countries: Set<string>;
      max_severity: string;
      count: number;
      oldest: string;
    }>();

    for (const row of allRows) {
      const drugId = row.drug_id as string;
      if (!drugId) continue;

      const cc = (row.country_code as string) ?? "XX";
      const sev = ((row.severity as string) ?? "high").toLowerCase();
      const reported = (row.reported_date as string) ?? "";

      if (!drugMap.has(drugId)) {
        drugMap.set(drugId, {
          drug_id: drugId,
          countries: new Set<string>(),
          max_severity: sev,
          count: 0,
          oldest: reported,
        });
      }

      const entry = drugMap.get(drugId)!;
      entry.countries.add(cc);
      entry.count++;
      if (SEV_ORDER.indexOf(sev) < SEV_ORDER.indexOf(entry.max_severity)) {
        entry.max_severity = sev;
      }
      if (reported && (!entry.oldest || reported < entry.oldest)) {
        entry.oldest = reported;
      }
    }

    // Get drug names for the top results
    const sorted = [...drugMap.values()]
      .sort((a, b) => b.countries.size - a.countries.size || b.count - a.count)
      .slice(0, 20);

    const drugIds = sorted.map((d) => d.drug_id);
    const { data: drugs } = await supabase
      .from("drugs")
      .select("id, generic_name")
      .in("id", drugIds.length > 0 ? drugIds : ["__none__"]);

    const nameMap = new Map((drugs ?? []).map((d: { id: string; generic_name: string }) => [d.id, d.generic_name]));

    const opportunities = sorted.map((d) => ({
      drug_id: d.drug_id,
      drug_name: nameMap.get(d.drug_id) ?? "Unknown",
      severity: d.max_severity,
      country_count: d.countries.size,
      countries: [...d.countries],
      active_shortage_count: d.count,
      oldest_reported: d.oldest,
    }));

    return NextResponse.json({ opportunities });
  } catch (err) {
    console.error("supplier/opportunities error:", err);
    return NextResponse.json({ opportunities: [], error: "Failed to fetch opportunities" }, { status: 500 });
  }
}
