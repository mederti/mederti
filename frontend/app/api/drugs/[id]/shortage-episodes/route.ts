import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { formOf, productOf } from "@/lib/event-product";

// Scrapers update shortage_events every 4h+; 10 minutes of staleness is fine.
export const revalidate = 600;

/**
 * GET /api/drugs/[id]/shortage-episodes
 *
 * Every regulator shortage notice for one molecule, compacted for the
 * per-country timeline on the drug page: when it started / ended, its status,
 * a short product description and a normalised dose form.
 *
 * Dose form is derived from each scraper's raw_data, whose keys differ per
 * regulator (TGA `dose_form`, Health Canada `dosage_form`, HSA
 * `product_name`, FAMHP `prescriptionName`, PMDA Japanese names …), so we
 * classify the concatenated text rather than trust one field. Strength is not
 * normalised — formats vary too much across regulators to split on honestly.
 */


interface Row {
  country_code: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  anticipated_start_date: string | null;
  estimated_resolution_date: string | null;
  source_url: string | null;
  raw_data: Record<string, unknown> | null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ episodes: [] }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const rows: Row[] = [];
  const PAGE = 1000;
  for (let page = 0; page < 10; page++) {
    const { data, error } = await sb
      .from("shortage_events")
      .select("country_code, status, start_date, end_date, anticipated_start_date, estimated_resolution_date, source_url, raw_data")
      .eq("drug_id", id)
      .eq("synthetic", false)
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) {
      if (rows.length === 0) return NextResponse.json({ degraded: true, episodes: [] });
      break;
    }
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }

  const seen = new Set<string>();
  const episodes = rows
    .map((r) => {
      const status = (r.status ?? "").toLowerCase();
      const start = (status === "anticipated" ? r.anticipated_start_date ?? r.start_date : r.start_date)?.slice(0, 10) ?? null;
      if (!start || !r.country_code) return null;
      return {
        country: r.country_code.toUpperCase(),
        status,
        start,
        end: r.end_date?.slice(0, 10) ?? null,
        expected_end: r.estimated_resolution_date?.slice(0, 10) ?? null,
        form: formOf(r.raw_data),
        product: productOf(r.raw_data),
        source_url: r.source_url,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e != null)
    // Scrapers occasionally hold the same notice twice (e.g. one per pack
    // size); identical rows add nothing to a timeline.
    .filter((e) => {
      const k = `${e.country}|${e.status}|${e.start}|${e.end}|${e.product}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  return NextResponse.json({ generated: new Date().toISOString().slice(0, 10), episodes });
}
