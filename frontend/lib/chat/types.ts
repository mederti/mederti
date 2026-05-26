export type DrugSummary = {
  drug_id: string;
  name: string;
  generic_name: string | null;
  brand_names: string[];
  atc_code: string | null;
  atc_description: string | null;
  drug_class: string | null;
  dosage_forms: string[];
  strengths: string[];
  routes_of_administration?: string[];
  therapeutic_category?: string | null;
  who_essential_medicine?: boolean;
  critical_medicine_eu?: boolean;
};

export type ShortageRow = {
  country: string;
  country_code: string | null;
  status: string;
  severity: string | null;
  reason: string | null;
  start_date: string | null;
  estimated_resolution_date: string | null;
  source_url: string | null;
};

export type DrugDetail = DrugSummary & {
  shortages: ShortageRow[];
  active_shortage_count: number;
  worst_severity: string | null;
  countries_affected: string[];
};

export type SubstituteRow = {
  drug_id: string;
  name: string;
  atc_code: string | null;
  drug_class: string | null;
  similarity_score: number | null;
  atc_match_level: number | null;
  clinical_evidence_level: string | null;
  requires_monitoring: boolean;
  availability_note: string | null;
  dose_conversion_notes: string | null;
  active_shortage_count: number;
};

export type RecallRow = {
  recall_id: string;
  drug_id: string | null;
  country_code: string | null;
  recall_class: string | null;
  reason: string | null;
  manufacturer: string | null;
  brand_name: string | null;
  generic_name: string | null;
  announced_date: string | null;
  status: string | null;
  press_release_url: string | null;
};

export type SupplierPriceRow = {
  country: string;
  unit_price: number | null;
  currency: string | null;
  pack_size: string | null;
  available_until: string | null;
  status: string | null;
  notes: string | null;
};

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

export type ChatApiResponse = {
  content: string;
  drugs: Record<string, DrugDetail>;
  subs?: Record<string, SubstituteRow>;
  error?: string;
  tool_calls?: number;
  truncated?: boolean;
};

export type SubstituteWithSuppliers = SubstituteRow & {
  suppliers?: SupplierStock[];
};

export type ManufacturerRow = {
  sponsor_id: string;
  name: string;
  country: string | null;
  product_count: number;
  countries_supplied: string[];
};

export type ProductRow = {
  product_id: string;
  product_name: string;
  trade_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  route: string | null;
  country: string | null;
  sponsor_id: string | null;
  sponsor_name: string | null;
  registry_status: string | null;
  pbs_listed: boolean | null;
  is_generic: boolean | null;
};

export type ShortageHistoryEvent = {
  country: string | null;
  country_code: string | null;
  severity: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
};

export type ShortageHistoryStats = {
  total_events: number;
  active_events: number;
  resolved_events: number;
  avg_resolved_duration_days: number | null;
  longest_resolved_duration_days: number | null;
  first_seen: string | null;
  last_resolved_at: string | null;
  countries_seen: string[];
  recurrences_by_country: Record<string, number>;
  timeline: ShortageHistoryEvent[];
};

export type DrugDetailBundle = {
  drug: DrugDetail;
  substitutes: SubstituteWithSuppliers[];
  recalls: RecallRow[];
  suppliers: SupplierStock[];
  manufacturers: ManufacturerRow[];
  history: ShortageHistoryStats;
  products: ProductRow[];
  error?: string;
};

export type Persona = "pharmacist" | "procurement" | "supplier";

export type SupplierStock = {
  supplier_id: string | null;
  supplier_name: string | null;
  countries: string[];
  unit_price: number | null;
  currency: string | null;
  pack_size: string | null;
  available_until: string | null;
  status: string | null;
  notes: string | null;
  verified: boolean;
  tier: string | null;
};

export type LeadType = "pre_order" | "forward_order" | "supplier_interest" | "order";

export type LeadInput = {
  lead_type: LeadType;
  contact_email: string;
  contact_name?: string;
  company_name?: string;
  drug_id?: string;
  drug_name?: string;
  alternative_drug_id?: string;
  alternative_drug_name?: string;
  supplier_name?: string;
  country_code?: string;
  volume_estimate?: string;
  notes?: string;
};

export type LeadResponse = { ok: boolean; lead_id?: string; persisted?: boolean; error?: string };
