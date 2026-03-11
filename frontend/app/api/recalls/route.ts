import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const country = sp.get("country");
  const recallClass = sp.get("recall_class");
  const status = sp.get("status");
  const dateFrom = sp.get("date_from");
  const dateTo = sp.get("date_to");
  const page = Math.max(1, Number(sp.get("page") ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("page_size") ?? 50)));

  const validClasses = new Set(["I", "II", "III", "Unclassified"]);
  const validStatuses = new Set(["active", "completed", "ongoing"]);

  if (recallClass && !validClasses.has(recallClass)) {
    return NextResponse.json({ error: `recall_class must be one of ${[...validClasses].sort()}` }, { status: 400 });
  }
  if (status && !validStatuses.has(status)) {
    return NextResponse.json({ error: `status must be one of ${[...validStatuses].sort()}` }, { status: 400 });
  }

  const offset = (page - 1) * pageSize;

  let query = getSupabaseAdmin()
    .from("recalls")
    .select(
      "id, recall_id, drug_id, generic_name, brand_name, manufacturer, " +
      "country_code, recall_class, recall_type, reason, reason_category, " +
      "lot_numbers, announced_date, completion_date, status, " +
      "press_release_url, confidence_score, " +
      "data_sources!recalls_source_id_fkey(name)",
      { count: "exact" }
    )
    .order("announced_date", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (country) query = query.eq("country_code", country.toUpperCase());
  if (recallClass) query = query.eq("recall_class", recallClass);
  if (status) query = query.eq("status", status);
  if (dateFrom) query = query.gte("announced_date", dateFrom);
  if (dateTo) query = query.lte("announced_date", dateTo);

  const { data: rows, count, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = ((rows ?? []) as any[]).map((r) => ({
    id: r.id,
    recall_id: r.recall_id,
    drug_id: r.drug_id ?? null,
    generic_name: r.generic_name,
    brand_name: r.brand_name ?? null,
    manufacturer: r.manufacturer ?? null,
    country_code: r.country_code,
    recall_class: r.recall_class ?? null,
    recall_type: r.recall_type ?? null,
    reason: r.reason ?? null,
    reason_category: r.reason_category ?? null,
    lot_numbers: r.lot_numbers ?? [],
    announced_date: String(r.announced_date),
    completion_date: r.completion_date ? String(r.completion_date) : null,
    status: r.status,
    press_release_url: r.press_release_url ?? null,
    confidence_score: r.confidence_score ?? 80,
    source_name: (r.data_sources ?? {}).name ?? null,
  }));

  return NextResponse.json({ page, page_size: pageSize, total: count ?? 0, results });
}
