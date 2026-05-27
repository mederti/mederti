// ============================================================================
// Mederti — Supabase database types
// ============================================================================
// Closes audit FINDING-F4-06 incrementally: 74 `: any` declarations + 125
// `as any` casts across the frontend exist because the Supabase client was
// untyped. This file gives strict types for the 5 hottest tables; the rest
// fall through to `Record<string, unknown>` via the index-signature
// fallback below so existing code keeps working unchanged.
//
// IMPORTANT — incremental adoption rules:
//
//   • New / refactored route handlers should use getSupabaseAdminTyped()
//     from `@/lib/supabase/admin` to get typed results.
//   • Existing routes that use the untyped getSupabaseAdmin() keep working
//     — adoption is opt-in per file.
//   • Rob action: run `npm run db:types` (once Supabase CLI is installed,
//     see `docs/supabase-types.md`) to generate the full Database type
//     from the live schema. This file becomes generated content at that
//     point; the hand-typed tables here become the floor, not the ceiling.
//
// The 5 hand-typed tables match the column shapes from migrations 001 +
// 009 + 016 + 019 + 029 + 039. Comments link each column to its origin
// migration so any future drift is traceable.
// ============================================================================

/** Generic JSON shape — matches Supabase's auto-generated Json type. */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** Index-signature fallback for any table not strictly typed below. */
type UnknownTable = {
  Row: Record<string, unknown>;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      // ── shortage_events (migrations 001 + 009 + 016 + 019 + 039) ────
      shortage_events: {
        Row: {
          id: string;
          /** MD5(drug_id|data_source_id|country|start_date) — set by trigger (001:241). */
          shortage_id: string;
          /** Nullable since 019 (auto-create-drug fallback allowed nulls). */
          drug_id: string | null;
          manufacturer_id: string | null;
          data_source_id: string;
          country: string;
          country_code: string | null;
          /** 'active' | 'resolved' | 'anticipated' | 'stale' */
          status: string;
          /** 'critical' | 'high' | 'medium' | 'low' | null */
          severity: string | null;
          reason: string | null;
          /** 'manufacturing_issue' | 'supply_chain' | 'demand_surge' | 'regulatory_action' | 'discontinuation' | 'raw_material' | 'distribution' | 'other' | 'unknown' | null */
          reason_category: string | null;
          start_date: string;
          end_date: string | null;
          estimated_resolution_date: string | null;
          /** Updated on every scraper run that re-confirms the row (base_scraper.py:613). */
          last_verified_at: string;
          source_url: string | null;
          raw_data: Json | null;
          notes: string | null;
          /** Added in migration 016. */
          availability_status: string | null;
          /** Added in migration 016 — regulator's recommended substitute action. */
          management_action: string | null;
          /** Added in migration 016 — pivot for joining to country-registry data. */
          product_registration_id: string | null;
          /** Added in migration 039 — supplier first-notification date (vs start_date which is when shortage took effect). */
          first_reported_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          shortage_id?: string; // trigger-set
          drug_id?: string | null;
          manufacturer_id?: string | null;
          data_source_id: string;
          country: string;
          country_code?: string | null;
          status?: string;
          severity?: string | null;
          reason?: string | null;
          reason_category?: string | null;
          start_date: string;
          end_date?: string | null;
          estimated_resolution_date?: string | null;
          last_verified_at?: string;
          source_url?: string | null;
          raw_data?: Json | null;
          notes?: string | null;
          availability_status?: string | null;
          management_action?: string | null;
          product_registration_id?: string | null;
          first_reported_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["shortage_events"]["Insert"]>;
        Relationships: [];
      };

      // ── drugs (migration 001 master registry) ────────────────────────
      drugs: {
        Row: {
          id: string;
          generic_name: string;
          generic_name_normalised: string | null;
          brand_names: string[];
          brand_names_text: string | null;
          atc_code: string | null;
          atc_description: string | null;
          drug_class: string | null;
          dosage_forms: string[];
          strengths: string[];
          routes_of_administration: string[];
          therapeutic_category: string | null;
          is_controlled_substance: boolean;
          controlled_substance_schedule: string | null;
          /** Weighted tsvector: A=generic, B=brand, C=ATC+category. Don't write directly. */
          search_vector: unknown | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          generic_name: string;
          generic_name_normalised?: string | null;
          brand_names?: string[];
          brand_names_text?: string | null;
          atc_code?: string | null;
          atc_description?: string | null;
          drug_class?: string | null;
          dosage_forms?: string[];
          strengths?: string[];
          routes_of_administration?: string[];
          therapeutic_category?: string | null;
          is_controlled_substance?: boolean;
          controlled_substance_schedule?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["drugs"]["Insert"]>;
        Relationships: [];
      };

      // ── data_sources (migration 001) ────────────────────────────────
      data_sources: {
        Row: {
          id: string;
          name: string;
          abbreviation: string;
          country: string;
          country_code: string;
          region: string | null;
          source_url: string;
          api_endpoint: string | null;
          scrape_frequency_hours: number;
          /** 0–1 reliability weight. */
          reliability_weight: number;
          is_active: boolean;
          /** Updated by BaseScraper._touch_data_source on every run (3778e79). */
          last_scraped_at: string | null;
          notes: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          abbreviation: string;
          country: string;
          country_code: string;
          region?: string | null;
          source_url: string;
          api_endpoint?: string | null;
          scrape_frequency_hours?: number;
          reliability_weight?: number;
          is_active?: boolean;
          last_scraped_at?: string | null;
          notes?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["data_sources"]["Insert"]>;
        Relationships: [];
      };

      // ── drug_alternatives (migration 001 + 006) ─────────────────────
      drug_alternatives: {
        Row: {
          id: string;
          drug_id: string;
          alternative_drug_id: string;
          /** 'therapeutic_equivalent' | 'pharmacological_alternative' | 'biosimilar' | 'generic' | 'therapeutic_class_alternative' */
          relationship_type: string;
          dose_conversion_notes: string | null;
          /** 'A' | 'B' | 'C' | 'D' | 'E' | null — A=RCT/meta, E=theoretical */
          clinical_evidence_level: string | null;
          requires_monitoring: boolean;
          monitoring_notes: string | null;
          created_by: string | null;
          verified_by: string | null;
          is_approved: boolean;
          /** Added in migration 006: 'manual' | 'atc' | 'rxnorm' | 'fda_orange_book' */
          source: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          drug_id: string;
          alternative_drug_id: string;
          relationship_type: string;
          dose_conversion_notes?: string | null;
          clinical_evidence_level?: string | null;
          requires_monitoring?: boolean;
          monitoring_notes?: string | null;
          created_by?: string | null;
          verified_by?: string | null;
          is_approved?: boolean;
          source?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["drug_alternatives"]["Insert"]>;
        Relationships: [];
      };

      // ── recalls (migration 007 + 043 alias) ─────────────────────────
      recalls: {
        Row: {
          id: string;
          recall_id: string;
          drug_id: string | null;
          /** Canonical FK to data_sources. */
          source_id: string;
          /** Generated alias of source_id (migration 043). Read-only — DON'T set on insert. */
          data_source_id: string;
          country_code: string;
          recall_class: string | null;
          recall_type: string | null;
          reason: string | null;
          reason_category: string | null;
          /** Denormalised — scrapers fill even when drug_id is null. */
          generic_name: string | null;
          brand_name: string | null;
          manufacturer: string | null;
          lot_numbers: string[] | null;
          announced_date: string;
          completion_date: string | null;
          status: string;
          press_release_url: string | null;
          confidence_score: number | null;
          raw_data: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          recall_id: string;
          drug_id?: string | null;
          source_id: string;
          // data_source_id is generated — never set on insert
          country_code: string;
          recall_class?: string | null;
          recall_type?: string | null;
          reason?: string | null;
          reason_category?: string | null;
          generic_name?: string | null;
          brand_name?: string | null;
          manufacturer?: string | null;
          lot_numbers?: string[] | null;
          announced_date: string;
          completion_date?: string | null;
          status?: string;
          press_release_url?: string | null;
          confidence_score?: number | null;
          raw_data?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["recalls"]["Insert"]>;
        Relationships: [];
      };
    } & {
      // Fallback for the ~46 tables we haven't strictly typed yet. Lets
      // existing untyped code keep working without TS errors; refactoring
      // a table to strict typing is opt-in by adding it to the block above.
      [tableName: string]: UnknownTable;
    };

    Views: {
      [viewName: string]: { Row: Record<string, unknown> };
    };

    Functions: {
      [functionName: string]: {
        Args: Record<string, unknown>;
        Returns: unknown;
      };
    };

    Enums: Record<string, never>;

    CompositeTypes: Record<string, never>;
  };
};
