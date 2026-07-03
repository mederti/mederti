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
  // Strip PostgREST filter metacharacters (comma / parens) from any value that
  // gets interpolated into an .or() expression — otherwise a value like
  // `x),(status.eq.foo` restructures the filter tree. Dots/spaces are safe
  // inside an ilike value; only the or()-structural chars matter.
  const orSafe = (s: string) => s.replace(/[,()]/g, " ").trim();
  const productName = searchParams.get("product_name")?.trim();
  const inn = searchParams.get("inn")?.trim();
  const rawCountry = searchParams.get("country")?.trim().toUpperCase();
  // Only accept a valid ISO alpha-2; anything else is dropped (not injected).
  const country = rawCountry && /^[A-Z]{2}$/.test(rawCountry) ? rawCountry : undefined;
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
    const pn = orSafe(productName);
    if (pn) q = q.or(`product_name.ilike.%${pn}%,brand_name.ilike.%${pn}%`);
  }
  if (inn) q = q.ilike("active_substance", `%${orSafe(inn)}%`);
  if (country) {
    q = q.or(`destination_country.eq.${country},source_country.eq.${country}`);
  }
  if (type === "EMA_PARALLEL_DISTRIBUTION" || type === "NATIONAL_PARALLEL_IMPORT") {
    q = q.eq("licence_type", type);
  }

  const { data, error } = await q;
  if (error) {
    // Don't leak PostgREST/schema internals to the client.
    console.error("[/api/parallel-trade/search] query error:", error.message);
    return NextResponse.json({ error: "search failed" }, { status: 500 });
  }

  return NextResponse.json({
    count: data?.length ?? 0,
    query: { product_name: productName ?? null, inn: inn ?? null, country: country ?? null, type: type ?? null },
    results: data ?? [],
  });
}
