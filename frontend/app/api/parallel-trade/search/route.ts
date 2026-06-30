import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/parallel-trade/search?product_name=&inn=&country=&type=&limit=
 *
 * Free search over parallel_trade_licences (independent of a specific drug).
 *   product_name — ilike on product_name / brand_name
 *   inn          — ilike on active_substance
 *   country      — destination_country OR source_country (ISO alpha-2)
 *   type         — EMA_PARALLEL_DISTRIBUTION | NATIONAL_PARALLEL_IMPORT
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const productName = searchParams.get("product_name")?.trim();
  const inn = searchParams.get("inn")?.trim();
  const country = searchParams.get("country")?.trim().toUpperCase();
  const type = searchParams.get("type")?.trim();
  const limit = Math.min(Number(searchParams.get("limit")) || 100, 500);

  if (!productName && !inn && !country) {
    return NextResponse.json(
      { error: "Provide at least one of product_name, inn or country" },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();
  let q = admin
    .from("parallel_trade_licences")
    .select(
      "id, licence_type, licence_number, status, product_name, brand_name, " +
        "active_substance, strength, dosage_form, pack_size, licence_holder, " +
        "source_country, destination_country, source_authority, source_url, " +
        "granted_date, last_checked"
    )
    .limit(limit);

  if (productName) {
    q = q.or(`product_name.ilike.%${productName}%,brand_name.ilike.%${productName}%`);
  }
  if (inn) q = q.ilike("active_substance", `%${inn}%`);
  if (country) {
    q = q.or(`destination_country.eq.${country},source_country.eq.${country}`);
  }
  if (type === "EMA_PARALLEL_DISTRIBUTION" || type === "NATIONAL_PARALLEL_IMPORT") {
    q = q.eq("licence_type", type);
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    count: data?.length ?? 0,
    query: { product_name: productName ?? null, inn: inn ?? null, country: country ?? null, type: type ?? null },
    results: data ?? [],
  });
}
