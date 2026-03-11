import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const country = sp.get("country");
  const status = sp.get("status");
  const severity = sp.get("severity");
  const sourceId = sp.get("source_id");
  const page = Math.max(1, Number(sp.get("page") ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("page_size") ?? 50)));

  const validStatuses = new Set(["active", "anticipated", "resolved", "stale"]);
  const validSeverities = new Set(["critical", "high", "medium", "low"]);

  if (status && !validStatuses.has(status)) {
    return NextResponse.json({ error: `status must be one of ${[...validStatuses].sort()}` }, { status: 400 });
  }
  if (severity && !validSeverities.has(severity)) {
    return NextResponse.json({ error: `severity must be one of ${[...validSeverities].sort()}` }, { status: 400 });
  }

  const offset = (page - 1) * pageSize;

  let query = getSupabaseAdmin()
    .from("shortage_events")
    .select(
      "shortage_id, drug_id, country, country_code, status, severity, " +
      "reason_category, start_date, estimated_resolution_date, source_url, " +
      "drugs(generic_name, brand_names), " +
      "data_sources(name)",
      { count: "exact" }
    )
    .order("start_date", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (country) query = query.eq("country_code", country.toUpperCase());
  if (status) query = query.eq("status", status);
  if (severity) query = query.eq("severity", severity);
  if (sourceId) query = query.eq("data_source_id", sourceId);

  const { data: rows, count, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = ((rows ?? []) as any[]).map((r) => {
    const drugData = r.drugs ?? {};
    const sourceData = r.data_sources ?? {};
    return {
      shortage_id: r.shortage_id,
      drug_id: r.drug_id,
      generic_name: drugData.generic_name ?? "",
      brand_names: drugData.brand_names ?? [],
      country: r.country ?? "",
      country_code: r.country_code ?? "",
      status: r.status,
      severity: r.severity ?? null,
      reason_category: r.reason_category ?? null,
      start_date: r.start_date ?? null,
      estimated_resolution_date: r.estimated_resolution_date ?? null,
      source_name: sourceData.name ?? null,
      source_url: r.source_url ?? null,
    };
  });

  return NextResponse.json({
    page,
    page_size: pageSize,
    total: count ?? 0,
    results,
  });
}
