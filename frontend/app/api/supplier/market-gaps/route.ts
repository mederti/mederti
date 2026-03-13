import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BATCH = 1000;

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    // 1. Fetch all active shortage_events (paginated)
    const shortageRows: Record<string, unknown>[] = [];
    let offset = 0;

    while (true) {
      const { data: batch } = await supabase
        .from("shortage_events")
        .select("drug_id, country_code")
        .in("status", ["active", "anticipated"])
        .range(offset, offset + BATCH - 1);

      const rows = batch ?? [];
      shortageRows.push(...rows);
      if (rows.length < BATCH) break;
      offset += BATCH;
    }

    // Group shortages by drug_id
    const shortageDrugs = new Map<string, { count: number; countries: Set<string> }>();
    for (const row of shortageRows) {
      const drugId = row.drug_id as string;
      if (!drugId) continue;
      if (!shortageDrugs.has(drugId)) {
        shortageDrugs.set(drugId, { count: 0, countries: new Set() });
      }
      const entry = shortageDrugs.get(drugId)!;
      entry.count++;
      entry.countries.add((row.country_code as string) ?? "XX");
    }

    // 2. For drugs with shortages, count their registered products
    const drugIds = [...shortageDrugs.keys()];
    if (drugIds.length === 0) {
      return NextResponse.json({ gaps: [] });
    }

    // Fetch product counts in batches
    const productCounts = new Map<string, number>();
    for (let i = 0; i < drugIds.length; i += 200) {
      const chunk = drugIds.slice(i, i + 200);
      const { data: products } = await supabase
        .from("drug_products")
        .select("drug_id")
        .in("drug_id", chunk);

      for (const p of products ?? []) {
        const did = (p as { drug_id: string }).drug_id;
        productCounts.set(did, (productCounts.get(did) ?? 0) + 1);
      }
    }

    // 3. Compute gap score and sort
    const gapEntries = drugIds.map((drugId) => {
      const shortage = shortageDrugs.get(drugId)!;
      const productCount = productCounts.get(drugId) ?? 0;
      const gapScore = shortage.count / Math.max(productCount, 1);
      return {
        drug_id: drugId,
        active_shortage_count: shortage.count,
        registered_product_count: productCount,
        gap_score: Math.round(gapScore * 100) / 100,
        affected_countries: [...shortage.countries],
      };
    });

    gapEntries.sort((a, b) => b.gap_score - a.gap_score);
    const top = gapEntries.slice(0, 15);

    // 4. Fetch drug names
    const topIds = top.map((g) => g.drug_id);
    const { data: drugs } = await supabase
      .from("drugs")
      .select("id, generic_name")
      .in("id", topIds.length > 0 ? topIds : ["__none__"]);

    const nameMap = new Map((drugs ?? []).map((d: { id: string; generic_name: string }) => [d.id, d.generic_name]));

    const gaps = top.map((g) => ({
      ...g,
      drug_name: nameMap.get(g.drug_id) ?? "Unknown",
    }));

    return NextResponse.json({ gaps });
  } catch (err) {
    console.error("supplier/market-gaps error:", err);
    return NextResponse.json({ gaps: [], error: "Failed to fetch market gaps" }, { status: 500 });
  }
}
