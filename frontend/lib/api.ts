// ============================================================================
// Mederti typed API client
// ============================================================================
// Routes are served by Next.js API Route Handlers under /api/*.
// No external backend dependency required.
//
// AUDIT NOTE — FINDING-B3-05 (partial fix):
// ─────────────────────────────────────────
// The typed client has historically been a 1:1 mirror of the legacy FastAPI
// surface that lived in api/routers/*. When the frontend moved to Next.js
// Route Handlers, some endpoints were ported and others were not. The
// October 2026 typed-client audit (commit TBD) found:
//
//   ✅ search                — backing route exists (revalidate=60 since
//                              bd13b60)
//   ✅ getDrug               — backing route exists, but no callers
//                              (kept available for future use)
//   ❌ getShortages          — NO backing /api/shortages handler. /home and
//                              /shortages pages call this; both wrap in
//                              try/catch and degrade gracefully to empty
//                              states. **Silent breakage** — users see no
//                              data on these pages.
//   ❌ getSummary            — NO backing /api/shortages/summary handler.
//                              Called from /home (same silent-degradation
//                              path as getShortages).
//   ❌ getRecalls            — NO backing /api/recalls handler. Called from
//                              /recalls page. Same silent-degradation.
//
// The 5 dead methods (getDrug excluded — it IS backed, just unused) with
// zero callers were deleted in this pass: getDrugShortages,
// getDrugAlternatives, getDrugRecalls, getRecallsSummary. They wrapped
// routes that don't exist AND weren't called from anywhere.
//
// The 3 broken methods above are kept in place for now — removing them
// would force a build-time refactor of /home, /shortages, /recalls.
// Next sprint: either (a) implement the 3 missing route handlers OR
// (b) refactor the calling pages to read Supabase directly.
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
}

export interface SearchResponse {
  query: string;
  results: DrugHit[];
  total: number;
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
  search: (q: string, limit = 10) =>
    apiFetch<SearchResponse>(`/search?q=${encodeURIComponent(q)}&limit=${limit}`),

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
