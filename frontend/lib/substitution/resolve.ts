// Substitution Agent engine — data loading. Server-only (service-role client).
// Reads everything rank.ts needs for one medicine in one market, then ranks.
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { extractEventBrand } from "@/lib/event-brand";
import { buildSupplyInMarket, type CatalogueRow } from "@/lib/supply-in-market";
import {
  rankSubstitution,
  type EligibilityRow,
  type EvidenceRow,
  type NoticeRow,
  type RecallRow,
  type SubstitutionAnswer,
} from "./rank";
import { sameMolecule, searchableMolecule, titleNamesMolecule } from "./molecule";

export type { SubstitutionAnswer, SubstitutionOption, Tier } from "./rank";

// Who publishes the notices in each market, for "TGA states on its notice…".
const NOTICE_PUBLISHER: Record<string, string> = {
  AU: "TGA", US: "FDA", CA: "Health Canada", GB: "MHRA/DHSC", DE: "BfArM", TW: "TFDA",
};

// Scrapers write the regulator's management advice into notes as
// "<Publisher> guidance: <verbatim text>" (tga_scraper.py does this for every
// TGA record). Only that line is used; the rest of notes is ours.
const GUIDANCE_LINE = /^[A-Za-z][\w /-]{0,30} guidance:\s*(.+)$/m;

export function guidanceFromNotes(notes: string | null): string | null {
  const m = (notes ?? "").match(GUIDANCE_LINE);
  return m ? m[1].trim() : null;
}

export async function resolveSubstitution(
  drugId: string,
  country: string,
  opts: { includeOtherPresentations?: boolean } = {},
): Promise<SubstitutionAnswer | null> {
  const sb = getSupabaseAdmin();
  const market = country.toUpperCase();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: drug }, { data: profile }] = await Promise.all([
    sb.from("drugs").select("id, generic_name").eq("id", drugId).maybeSingle(),
    // The nightly molecule profile groups a medicine's fragmented drugs rows
    // (salt forms, register spellings). Notices and register rows often sit on
    // a sibling row, so read them for the whole molecule.
    sb.from("inn_risk_scores").select("display_name, drug_ids").contains("drug_ids", [drugId]).limit(1),
  ]);
  if (!drug) return null;
  const prof = (profile?.[0] ?? null) as { display_name: string; drug_ids: string[] } | null;
  // Sibling rows that are the same molecule by strict salt-form name match
  // (molecule.ts) — the profile covers only ~560 molecules.
  const molecule = searchableMolecule(prof?.display_name ?? (drug.generic_name as string));
  let siblings: string[] = [];
  if (molecule) {
    const { data, error } = await sb.from("drugs").select("id, generic_name").ilike("generic_name", `${molecule}%`).limit(300);
    if (error) throw error;
    siblings = (data ?? []).filter((d) => sameMolecule(d.generic_name as string, molecule)).map((d) => d.id as string);
  }
  const ids = [...new Set([drugId, ...(prof?.drug_ids ?? []), ...siblings])].slice(0, 150);

  const [catRes, noticeRes, evRes, eligRes, recallRes, unlinkedRes] = await Promise.all([
    sb.from("drug_catalogue")
      .select("brand_name, strength, dosage_form, sponsor, registration_number, active_ingredients")
      .in("drug_id", ids).eq("source_country", market).eq("registration_status", "active").limit(1000),
    sb.from("shortage_events")
      .select("status, start_date, anticipated_start_date, estimated_resolution_date, source_url, notes, last_verified_at, data_source_id, artg:raw_data->>artg_numb, din:raw_data->>din, dose_form:raw_data->>dose_form, ca_form:raw_data->>dosage_form, ingredients:raw_data->>ingredients, raw_data")
      .in("drug_id", ids).eq("country_code", market).in("status", ["active", "anticipated"])
      .or("synthetic.is.null,synthetic.eq.false").limit(200),
    sb.from("alternative_evidence")
      .select("drug_id, alternative_drug_id, kind, publisher, source_code, authority_type, source_ref, source_url, statement, indication, country_code, drug_name_raw, alternative_name_raw, alternative_product, dose_statement, valid_from, valid_until, retrieved_at")
      .in("drug_id", ids)
      .or(`valid_until.is.null,valid_until.gte.${today}`)
      .limit(500),
    sb.from("regulatory_eligibility")
      .select("scheme, country_code, brand_name, generic_name, scheme_reference, description, listed_at, expires_at, source_url, last_verified_at")
      .in("drug_id", ids).eq("country_code", market).eq("status", "active").limit(100),
    sb.from("recalls")
      .select("recall_class, brand_name, generic_name, reason, announced_date, press_release_url")
      .in("drug_id", ids).eq("country_code", market).eq("status", "active")
      .order("announced_date", { ascending: false }).limit(10),
    // Active approvals the scraper couldn't link to a drug row (43 s19A rows
    // on 2026-11-02). Matched below only when the regulator's own title names
    // this molecule as its single ingredient.
    molecule
      ? sb.from("regulatory_eligibility")
          .select("scheme, country_code, brand_name, generic_name, scheme_reference, description, listed_at, expires_at, source_url, last_verified_at")
          .is("drug_id", null).eq("country_code", market).eq("status", "active")
          .ilike("brand_name", `%${molecule}%`).limit(50)
      : Promise.resolve({ data: [], error: null }),
  ]);
  // A failed read must never look like "no alternatives on file".
  for (const r of [catRes, noticeRes, evRes, eligRes, recallRes, unlinkedRes]) if (r.error) throw r.error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawNotices = (noticeRes.data ?? []) as any[];
  const supply = buildSupplyInMarket(
    market,
    (catRes.data ?? []) as CatalogueRow[],
    rawNotices.map((n) => ({
      status: n.status,
      start_date: n.start_date,
      anticipated_start_date: n.anticipated_start_date,
      estimated_resolution_date: n.estimated_resolution_date,
      source_url: n.source_url,
      regNo: n.artg ?? n.din ?? null,
      productName: extractEventBrand(n.data_source_id ?? null, n.raw_data).brand_name,
      doseForm: n.dose_form ?? n.ca_form ?? null,
      ingredients: typeof n.ingredients === "string" ? n.ingredients.split(";").map((x: string) => x.trim()).filter(Boolean) : undefined,
    })),
  );
  const publisher = NOTICE_PUBLISHER[market] ?? "The regulator";
  const notices: NoticeRow[] = rawNotices.map((n) => ({
    product: extractEventBrand(n.data_source_id ?? null, n.raw_data).brand_name,
    status: n.status,
    start_date: n.status === "anticipated" ? n.anticipated_start_date ?? n.start_date : n.start_date,
    estimated_resolution_date: n.estimated_resolution_date,
    source_url: n.source_url,
    guidance: guidanceFromNotes(n.notes),
    publisher,
    last_verified_at: n.last_verified_at,
  }));

  // Alternative names for therapeutic rows.
  const evRows = (evRes.data ?? []) as Omit<EvidenceRow, "alternative_name">[];
  const altIds = [...new Set(evRows.map((e) => e.alternative_drug_id).filter(Boolean) as string[])];
  const names = new Map<string, string>();
  if (altIds.length) {
    const { data, error } = await sb.from("drugs").select("id, generic_name").in("id", altIds.slice(0, 300));
    if (error) throw error;
    for (const d of data ?? []) names.set(d.id as string, d.generic_name as string);
  }

  return rankSubstitution({
    drug: { id: drug.id as string, name: prof?.display_name ?? (drug.generic_name as string) },
    moleculeIds: ids,
    country: market,
    today,
    supply,
    notices,
    evidence: evRows.map((e) => ({ ...e, alternative_name: e.alternative_drug_id ? names.get(e.alternative_drug_id) ?? null : null })),
    eligibility: [
      ...((eligRes.data ?? []) as EligibilityRow[]),
      ...((unlinkedRes.data ?? []) as EligibilityRow[])
        .filter((r) => molecule && titleNamesMolecule(r.brand_name, molecule))
        .map((r) => ({ ...r, matched_by_name: true })),
    ],
    recalls: (recallRes.data ?? []) as RecallRow[],
    includeOtherPresentations: opts.includeOtherPresentations,
  });
}
