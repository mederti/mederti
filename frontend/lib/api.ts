// Routes are now served by Next.js API Route Handlers under /api/*
// No external backend dependency required.
const BASE = "/api";

export interface DrugHit {
  drug_id: string;
  generic_name: string;
  brand_names: string[];
  atc_code: string | null;
  active_shortage_count: number;
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

export interface Alternative {
  alternative_drug_id: string;
  alternative_generic_name: string;
  alternative_brand_names: string[];
  relationship_type: string;
  clinical_evidence_level: string | null;
  similarity_score: number | null;
  dose_conversion_notes: string | null;
  availability_note: string | null;
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

export interface RecallSummary {
  id: string;
  recall_id: string;
  country_code: string;
  recall_class: string | null;
  generic_name: string;
  brand_name: string | null;
  manufacturer: string | null;
  announced_date: string;
  status: string;
  reason_category: string | null;
  press_release_url: string | null;
  linked_shortages: number;
}

export interface DrugRecallsResponse {
  drug_id: string;
  resilience_score: number;
  recalls: RecallSummary[];
}

export interface RecallSummaryResponse {
  total_active: number;
  class_i_count: number;
  new_this_month: number;
  by_country: Array<{ country_code: string; count: number }>;
  by_class: Record<string, number>;
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
  const res = await fetch(`${BASE}${path}`, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

export const api = {
  search: (q: string, limit = 10) =>
    apiFetch<SearchResponse>(`/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  getDrug: (id: string) =>
    apiFetch<DrugDetail>(`/drugs/${id}`),

  getDrugShortages: (id: string, status?: string) =>
    apiFetch<ShortageEvent[]>(
      `/drugs/${id}/shortages${status ? `?status=${status}` : ""}`
    ),

  getDrugAlternatives: (id: string) =>
    apiFetch<Alternative[]>(`/drugs/${id}/alternatives`),

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

  getDrugRecalls: (id: string) =>
    apiFetch<DrugRecallsResponse>(`/drugs/${id}/recalls`),

  getRecalls: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(
      Object.entries(params).reduce((acc, [k, v]) => {
        acc[k] = String(v);
        return acc;
      }, {} as Record<string, string>)
    ).toString();
    return apiFetch<RecallListResponse>(`/recalls?${qs}`);
  },

  getRecallsSummary: () =>
    apiFetch<RecallSummaryResponse>("/recalls/summary"),
};
