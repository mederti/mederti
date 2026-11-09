import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  getDependenceIndex,
  resolveCountry,
  singleCountryView,
  whatIfView,
  moleculeView,
} from "@/lib/supply/api-country-dependence";

// A cold index build pages every fda_dmf supplier row and every open shortage
// row; it is cached for an hour (lib/supply/api-country-dependence.ts).
export const maxDuration = 120;

/**
 * GET /api/api-country-dependence
 *
 * Known FDA Drug Master File (DMF) API holders by country — NOT market share
 * or actual supply. Every response carries sources, dates, coverage and caveats.
 *
 *   ?drug_id=<uuid> | ?name=<INN>  one molecule's DMF holders by country
 *   ?stop=<country>                what-if: if <country> stopped exporting, which
 *                                  short / anticipated drugs lose all known holders
 *     &include_not_short=1         …across all drugs with a DMF holder instead
 *   (default)                      drugs whose known holders are all in one country
 *     &country=<country>           …only those dependent on <country>
 *     &short_only=1                …only drugs short or anticipated somewhere now
 *   &limit=<n>                     items per list (default 50, max 500)
 *
 * <country> accepts a DECRS country name ("China") or ISO-2 code ("CN").
 */
export async function GET(req: Request) {
  const limited = await enforceRateLimit(req, "strict");
  if (limited) return limited;

  const url = new URL(req.url);
  const p = url.searchParams;
  const limit = Number(p.get("limit")) || undefined;
  const flag = (k: string) => ["1", "true", "yes"].includes((p.get(k) ?? "").toLowerCase());

  const idx = await getDependenceIndex();

  const drugId = p.get("drug_id");
  const name = p.get("name");
  if (drugId || name) {
    let v = moleculeView(idx, { drugId, name });
    if (!v && drugId && !name) {
      const { data } = await getSupabaseAdmin().from("drugs").select("generic_name,resolved_inn").eq("id", drugId).maybeSingle();
      if (data) v = moleculeView(idx, { name: data.resolved_inn || data.generic_name });
    }
    if (!v) return NextResponse.json({ drug_id: drugId, name, dmf_holders: 0, note: "No active Type II FDA DMF holder is on file for this molecule in Mederti's data. That means no US DMF was found under this name, not that no API maker exists." });
    return NextResponse.json(v);
  }

  const countryParam = p.get("stop") ?? p.get("country");
  const country = countryParam ? resolveCountry(countryParam, idx) : null;
  if (countryParam && !country) {
    return NextResponse.json(
      { error: "unknown_country", detail: `No DMF holder in Mederti's data has country '${countryParam}'. Use a country name (e.g. China) or ISO-2 code.` },
      { status: 400 },
    );
  }

  const body = p.get("stop")
    ? whatIfView(idx, country!, { includeNotShort: flag("include_not_short"), limit })
    : singleCountryView(idx, { country, shortOnly: flag("short_only"), limit });

  return NextResponse.json(body, { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } });
}
