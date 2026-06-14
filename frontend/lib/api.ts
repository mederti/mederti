// ============================================================================
// Mederti typed API client
// ============================================================================
// Routes are served by Next.js API Route Handlers under /api/*.
// No external backend dependency required.
//
// AUDIT NOTE — FINDING-B3-05 (FULLY CLOSED):
// ──────────────────────────────────────────
// The typed client mirrors the legacy FastAPI surface. The Oct 2026 audit
// found 7 of 9 methods wrapped routes that didn't exist as Next handlers.
// Cleanup landed in two passes:
//
//   ✅ search                — backing route exists (revalidate=60, bd13b60)
//   ✅ getDrug               — backing route exists, no callers
//   ✅ getShortages          — /api/shortages SHIPPED, revalidate=60
//   ✅ getSummary            — /api/shortages/summary SHIPPED, revalidate=300
//   ✅ getRecalls            — /api/recalls SHIPPED, revalidate=120
//
// The 4 dead methods with zero callers were deleted in 34acfd6:
// getDrugShortages, getDrugAlternatives, getDrugRecalls, getRecallsSummary.
//
// All remaining methods are backed by real handlers; /home, /shortages,
// /recalls now render with their actual data instead of degrading silently
// to empty-state cards.
// ============================================================================

// Server Components need an absolute URL; client-side can use relative.
function getBase() {
  if (typeof window !== "undefined") return "/api"; // browser
  const vercelUrl = process.env.VERCEL_URL; // e.g. myapp-abc123.vercel.app
  if (vercelUrl) return `https://${vercelUrl}/api`;
  return `http://localhost:${process.env.PORT ?? 3000}/api`;
}

export interface DrugHit {
  drug_id: string;
  generic_name: string;
  brand_names: string[];
  atc_code: string | null;
  active_shortage_count: number;
  alternatives_count?: number;
  source?: "drugs" | "catalogue";
  source_country?: string;
  source_name?: string;
  registration_number?: string;
  // Table-view enrichment (country-scoped to the chosen market).
  market_severity?: number;
  other_markets_short?: number;
  estimated_resolution_date?: string | null;
  last_verified_at?: string | null;
  substitution?: { scheme: string; reference: string | null } | null;
  best_alternative?: { name: string; relationship: string | null } | null;
  trade_price?: { ex_manufacturer: number; dispensed: number | null; currency: string; pack: string | null; label?: string; source?: string } | null;
  // Form/Strength (catalogue product rows; migration 054).
  form_bucket?: string | null;
  strength_label?: string | null;
}

export interface StatusFacets {
  shortage: number;
  supply: number;
  resolved: number;
}

export interface SearchResponse {
  query: string;
  results: DrugHit[];
  total: number;
  /** Closest canonical drug name when the query matched nothing (typo fallback). */
  suggestion?: string | null;
  market?: string;
  sort?: string;
  status?: string[];
  form?: string[];
  strength?: string[];
  supplements_included?: boolean;
  facets?: { status: StatusFacets; form?: Record<string, number>; strength?: Record<string, number> };
}

export interface DrugDetail {
  drug_id: string;
  generic_name: string;
  brand_names: string[];
  atc_code: string | null;
  atc_description: string | null;
  drug_class: string | null;
  dosage_forms: string[];
  strengths: string[];
  routes_of_administration: string[];
  therapeutic_category: string | null;
  is_controlled_substance: boolean | null;
}

// Per-event shortage row (used by /search/page.tsx and any future detail view).
// Kept distinct from ShortageRow which carries drug-context columns for list views.
export interface ShortageEvent {
  shortage_id: string;
  country: string;
  country_code: string;
  status: string;
  severity: string | null;
  reason: string | null;
  reason_category: string | null;
  start_date: string | null;
  end_date: string | null;
  estimated_resolution_date: string | null;
  source_name: string | null;
  source_url: string | null;
  last_verified_at: string | null;
}

export interface ShortageRow {
  shortage_id: string;
  drug_id: string;
  generic_name: string;
  brand_names: string[];
  country: string;
  country_code: string;
  status: string;
  severity: string | null;
  reason_category: string | null;
  start_date: string | null;
  estimated_resolution_date: string | null;
  source_name: string | null;
  source_url: string | null;
}

export interface ShortageListResponse {
  page: number;
  page_size: number;
  total: number;
  results: ShortageRow[];
}

export interface RecallRow {
  id: string;
  recall_id: string;
  drug_id: string | null;
  generic_name: string;
  brand_name: string | null;
  manufacturer: string | null;
  country_code: string;
  recall_class: string | null;
  recall_type: string | null;
  reason: string | null;
  reason_category: string | null;
  lot_numbers: string[];
  announced_date: string;
  completion_date: string | null;
  status: string;
  press_release_url: string | null;
  confidence_score: number;
  source_name: string | null;
}

export interface RecallListResponse {
  page: number;
  page_size: number;
  total: number;
  results: RecallRow[];
}

export interface SummaryResponse {
  by_severity: Record<string, number>;
  by_category: Array<{ category: string; count: number; max_severity: string }>;
  by_country: Array<{ country_code: string; country: string; count: number; max_severity: string }>;
  total_active: number;
  new_this_month: number;
  resolved_this_month: number;
}

async function apiFetch<T>(path: string): Promise<T> {
  const base = getBase();
  const res = await fetch(`${base}${path}`, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

export const api = {
  // ── ✅ Backed by a real route handler ────────────────────────────────
  search: (
    q: string,
    limit = 10,
    opts?: { market?: string; status?: string[]; sort?: string; form?: string[]; strength?: string[]; supplements?: boolean }
  ) => {
    const p = new URLSearchParams({ q, limit: String(limit) });
    if (opts?.market) p.set("market", opts.market);
    if (opts?.status?.length) p.set("status", opts.status.join(","));
    if (opts?.sort && opts.sort !== "relevance") p.set("sort", opts.sort);
    if (opts?.form?.length) p.set("form", opts.form.join(","));
    if (opts?.strength?.length) p.set("strength", opts.strength.join(","));
    if (opts?.supplements) p.set("supplements", "1");
    return apiFetch<SearchResponse>(`/search?${p.toString()}`);
  },

  getDrug: (id: string) =>
    apiFetch<DrugDetail>(`/drugs/${id}`),

  // ── ❌ Broken: NO backing route handler (FINDING-B3-05) ──────────────
  // These wrappers stay in place so /home, /shortages, /recalls compile;
  // those pages already wrap in try/catch + degrade to empty states.
  // Removing them would break the build; implementing the routes is the
  // right next move (see file header).
  getShortages: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(
      Object.entries(params).reduce((acc, [k, v]) => {
        acc[k] = String(v);
        return acc;
      }, {} as Record<string, string>)
    ).toString();
    return apiFetch<ShortageListResponse>(`/shortages?${qs}`);
  },

  getSummary: () =>
    apiFetch<SummaryResponse>("/shortages/summary"),

  getRecalls: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(
      Object.entries(params).reduce((acc, [k, v]) => {
        acc[k] = String(v);
        return acc;
      }, {} as Record<string, string>)
    ).toString();
    return apiFetch<RecallListResponse>(`/recalls?${qs}`);
  },
};
