import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/security/rate-limit";

// Closes audit FINDING-B3-05 (full fix). Restores /recalls page data —
// previously called api.getRecalls() which hit a non-existent route.
//
// 2-minute edge cache. Recalls only land when scrapers run (typically
// 06:00–07:30 UTC daily, plus the on-Mac stagger); short cache window
// gives common filter combos (country+class) a cheap hit while keeping
// staleness invisible.
export const revalidate = 120;

const VALID_CLASSES = new Set(["I", "II", "III", "Unclassified"]);

type DrugSidecar = { generic_name: string | null };
type SourceSidecar = { name: string | null };
type RawRecall = {
  id: string;
  recall_id: string;
  drug_id: string | null;
  generic_name: string | null;
  brand_name: string | null;
  manufacturer: string | null;
  country_code: string;
  recall_class: string | null;
  recall_type: string | null;
  reason: string | null;
  reason_category: string | null;
  lot_numbers: string[] | null;
  announced_date: string;
  completion_date: string | null;
  status: string;
  press_release_url: string | null;
  confidence_score: number | null;
  drugs: DrugSidecar | null;
  data_sources: SourceSidecar | null;
};

export async function GET(req: NextRequest) {
  const limited = await enforceRateLimit(req, "browse");
  if (limited) return limited;

  const url = new URL(req.url);
  const countryCode = url.searchParams.get("country_code");
  const recallClass = url.searchParams.get("recall_class");
  const status = url.searchParams.get("status");

  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("page_size") ?? "50") || 50));

  if (recallClass && !VALID_CLASSES.has(recallClass)) {
    return NextResponse.json(
      { error: `recall_class must be one of: ${[...VALID_CLASSES].join(", ")}` },
      { status: 400 },
    );
  }

  const sb = getSupabaseAdmin();
  const offset = (page - 1) * pageSize;

  let query = sb
    .from("recalls")
    .select(
      `id, recall_id, drug_id, generic_name, brand_name, manufacturer,
       country_code, recall_class, recall_type, reason, reason_category,
       lot_numbers, announced_date, completion_date, status,
       press_release_url, confidence_score,
       drugs(generic_name),
       data_sources(name)`,
      { count: "exact" },
    )
    .order("announced_date", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (countryCode) query = query.eq("country_code", countryCode.toUpperCase());
  if (recallClass) query = query.eq("recall_class", recallClass);
  if (status) query = query.eq("status", status);

  const { data, count, error } = await query;
  if (error) {
    console.error("[/api/recalls] supabase error:", error.message);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as RawRecall[];

  const results = rows.map((r) => ({
    id: r.id,
    recall_id: r.recall_id,
    drug_id: r.drug_id,
    // Prefer the joined drugs row's generic_name; fall back to the
    // denormalised column on recalls (scrapers fill this even when no
    // drug match exists, so /recalls list still shows something useful).
    generic_name: r.drugs?.generic_name ?? r.generic_name ?? "",
    brand_name: r.brand_name,
    manufacturer: r.manufacturer,
    country_code: r.country_code,
    recall_class: r.recall_class,
    recall_type: r.recall_type,
    reason: r.reason,
    reason_category: r.reason_category,
    lot_numbers: r.lot_numbers ?? [],
    announced_date: r.announced_date,
    completion_date: r.completion_date,
    status: r.status,
    press_release_url: r.press_release_url,
    confidence_score: r.confidence_score ?? 0,
    source_name: r.data_sources?.name ?? null,
  }));

  return NextResponse.json({
    page,
    page_size: pageSize,
    total: count ?? 0,
    results,
  });
}
