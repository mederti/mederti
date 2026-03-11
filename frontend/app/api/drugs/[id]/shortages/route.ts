import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const status = req.nextUrl.searchParams.get("status");

  // Verify drug exists
  const { data: drug } = await getSupabaseAdmin()
    .from("drugs")
    .select("id")
    .eq("id", id)
    .limit(1)
    .single();

  if (!drug) {
    return NextResponse.json({ error: `Drug '${id}' not found` }, { status: 404 });
  }

  let query = getSupabaseAdmin()
    .from("shortage_events")
    .select(
      "shortage_id, country, country_code, status, severity, " +
      "reason, reason_category, start_date, end_date, " +
      "estimated_resolution_date, source_url, last_verified_at, " +
      "data_sources(name)"
    )
    .eq("drug_id", id)
    .order("start_date", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = ((rows ?? []) as any[]).map((r) => ({
    shortage_id: r.shortage_id,
    country: r.country ?? "",
    country_code: r.country_code ?? "",
    status: r.status,
    severity: r.severity ?? null,
    reason: r.reason ?? null,
    reason_category: r.reason_category ?? null,
    start_date: r.start_date ?? null,
    end_date: r.end_date ?? null,
    estimated_resolution_date: r.estimated_resolution_date ?? null,
    source_name: (r.data_sources ?? {}).name ?? null,
    source_url: r.source_url ?? null,
    last_verified_at: r.last_verified_at ?? null,
  }));

  return NextResponse.json(results);
}
