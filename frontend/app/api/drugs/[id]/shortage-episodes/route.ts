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

  // Typed vaccines read notices by the vaccine each notice itself names
  // (shortage_events.vaccine_type, migration 082), not by the drugs row they
  // were filed on — the same rule as the drug page, so the timeline and the
  // status section agree. Falls back to drug_id if the columns are missing.
  let vaccineKey: string | null = null;
  try {
    const { data: self } = await sb.from("drugs").select("vaccine_type").eq("id", id).maybeSingle();
    vaccineKey = (self?.vaccine_type as string | null) ?? null;
  } catch { /* not typed */ }

  const fetchRows = async (byVaccine: boolean): Promise<{ rows: Row[]; failed: boolean }> => {
    const rows: Row[] = [];
    const PAGE = 1000;
    for (let page = 0; page < 10; page++) {
      let q = sb
        .from("shortage_events")
        .select("country_code, status, start_date, end_date, anticipated_start_date, estimated_resolution_date, source_url, raw_data")
        .eq("synthetic", false);
      q = byVaccine
        ? q.or(`vaccine_type.eq.${vaccineKey},and(drug_id.eq.${id},vaccine_type.is.null)`)
        : q.eq("drug_id", id);
      const { data, error } = await q.order("id", { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) return { rows, failed: rows.length === 0 };
      rows.push(...((data ?? []) as Row[]));
      if (!data || data.length < PAGE) break;
    }
    return { rows, failed: false };
  };

  let got = await fetchRows(!!vaccineKey);
  if (got.failed && vaccineKey) got = await fetchRows(false);
  if (got.failed) return NextResponse.json({ degraded: true, episodes: [] });
  const rows = got.rows;

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
