import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/parallel-trade/countries/[country_code]
 *
 * Country view: all parallel-trade licences whose destination is the given
 * market (ISO alpha-2), with a summary of the top source countries and
 * distributors. Useful for a per-country parallel-trade overview.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ country_code: string }> }
) {
  const { country_code } = await ctx.params;
  const code = (country_code || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    return NextResponse.json({ error: "country_code must be ISO alpha-2" }, { status: 400 });
  }
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit")) || 200, 1000);

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("parallel_trade_licences")
    .select(
      "id, licence_type, licence_number, status, product_name, brand_name, " +
        "active_substance, strength, dosage_form, pack_size, licence_holder, " +
        "source_country, destination_country, source_authority, source_url, last_checked"
    )
    .eq("destination_country", code)
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as Array<{
    source_country: string | null;
    licence_holder: string | null;
    licence_type: string;
  }>;
  const bySource = new Map<string, number>();
  const byDistributor = new Map<string, number>();
  let ema = 0;
  let national = 0;
  for (const row of rows) {
    if (row.source_country) bySource.set(row.source_country, (bySource.get(row.source_country) ?? 0) + 1);
    if (row.licence_holder) byDistributor.set(row.licence_holder, (byDistributor.get(row.licence_holder) ?? 0) + 1);
    if (row.licence_type === "EMA_PARALLEL_DISTRIBUTION") ema += 1;
    else national += 1;
  }
  const top = (m: Map<string, number>) =>
    Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));

  return NextResponse.json({
    country: code,
    total: rows.length,
    ema_distribution_count: ema,
    national_import_count: national,
    top_source_countries: top(bySource),
    top_distributors: top(byDistributor),
    licences: rows,
  });
}
