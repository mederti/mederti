import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminTyped } from "@/lib/supabase/admin";

// Closes audit FINDING-B3-05 (full fix). Restores the data flow to
// /home + /shortages — previously these called api.getShortages() which
// hit a non-existent /api/shortages route; the pages caught the failure
// silently and degraded to empty-state cards.
//
// 60-second edge cache. Common filter combos (country=AU&status=active,
// status=active&severity=critical) hit the cache repeatedly across
// users. Shortage events change at scraper cadence (every 4 h+), so
// 60-second staleness is invisible.
export const revalidate = 60;

const VALID_STATUSES = new Set(["active", "anticipated", "resolved", "stale"]);
const VALID_SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

type DrugSidecar = { generic_name: string | null; brand_names: string[] | null };
type SourceSidecar = { name: string | null };
type RawRow = {
  shortage_id: string;
  drug_id: string | null;
  country: string | null;
  country_code: string | null;
  status: string;
  severity: string | null;
  reason_category: string | null;
  start_date: string | null;
  estimated_resolution_date: string | null;
  source_url: string | null;
  drugs: DrugSidecar | null;
  data_sources: SourceSidecar | null;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const country = url.searchParams.get("country");
  const status = url.searchParams.get("status");
  const severity = url.searchParams.get("severity");
  const sourceId = url.searchParams.get("source_id");
  const sort = url.searchParams.get("sort") ?? "start_date";

  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("page_size") ?? "50") || 50));

  if (status && !VALID_STATUSES.has(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${[...VALID_STATUSES].join(", ")}` },
      { status: 400 },
    );
  }
  if (severity && !VALID_SEVERITIES.has(severity)) {
    return NextResponse.json(
      { error: `severity must be one of: ${[...VALID_SEVERITIES].join(", ")}` },
      { status: 400 },
    );
  }

  // Typed client — types from frontend/types/db.ts (see docs/supabase-types.md).
  // Status / severity / country_code columns flow through as typed strings.
  const sb = getSupabaseAdminTyped();
  const offset = (page - 1) * pageSize;

  // Sort handling: `sort=severity` is a synthetic order we apply in JS after
  // fetching (severity is an enum so we rank it client-side). Anything else
  // falls back to start_date DESC. Keeps the SQL stable + indexable.
  const orderColumn = sort === "severity" ? "start_date" : (sort || "start_date");

  let query = sb
    .from("shortage_events")
    .select(
      `shortage_id, drug_id, country, country_code, status, severity,
       reason_category, start_date, estimated_resolution_date, source_url,
       drugs(generic_name, brand_names),
       data_sources(name)`,
      { count: "exact" },
    )
    .order(orderColumn, { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (country) query = query.eq("country_code", country.toUpperCase());
  if (status) query = query.eq("status", status);
  if (severity) query = query.eq("severity", severity);
  if (sourceId) query = query.eq("data_source_id", sourceId);

  const { data, count, error } = await query;
  if (error) {
    console.error("[/api/shortages] supabase error:", error.message);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as RawRow[];

  // Apply synthetic severity sort if requested (post-fetch JS sort).
  if (sort === "severity") {
    rows.sort((a, b) => (SEV_RANK[b.severity ?? ""] ?? 0) - (SEV_RANK[a.severity ?? ""] ?? 0));
  }

  const results = rows.map((r) => ({
    shortage_id: r.shortage_id,
    drug_id: r.drug_id ?? "",
    generic_name: r.drugs?.generic_name ?? "",
    brand_names: r.drugs?.brand_names ?? [],
    country: r.country ?? "",
    country_code: r.country_code ?? "",
    status: r.status,
    severity: r.severity,
    reason_category: r.reason_category,
    start_date: r.start_date,
    estimated_resolution_date: r.estimated_resolution_date,
    source_name: r.data_sources?.name ?? null,
    source_url: r.source_url,
  }));

  return NextResponse.json({
    page,
    page_size: pageSize,
    total: count ?? 0,
    results,
  });
}
