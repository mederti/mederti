// Client-safe types + labels for source-backed alternatives (no DB access here).
export type AlternativeStatus = "regulator_authorised" | "verified" | "single_source";

export type AlternativeCitation = {
  publisher: string;
  source_code: string;
  authority_type: "regulator_legal" | "regulator_guidance" | "clinical_reference";
  source_url: string;
  statement: string;
  indication: string | null;
  country_code: string | null;
  alternative_product: string | null;
  product_ref: string | null;
  dose_statement: string | null;
  valid_until: string | null;
  licence: string | null;
  retrieved_at: string;
};

export type SourcedAlternative = {
  alternative_drug_id: string;
  name: string;
  kind: "same_molecule" | "therapeutic";
  status: AlternativeStatus;
  status_label: string;
  publishers: string[];
  /** Jurisdictions where a current legal instrument authorises it, e.g. "US (FDA)". */
  legal_scopes: string[];
  /** true when the alternative is another product of the SAME drug row. */
  same_drug: boolean;
  last_checked_at: string;
  citations: AlternativeCitation[];
};

export type SourcedAlternativesResult =
  | { available: true; alternatives: SourcedAlternative[] }
  // The evidence table isn't in this database yet (migration 071 unapplied).
  // Callers must say "not available", never "none on file".
  | { available: false; reason: string };


// Source names as users should see them (attribution required by e.g. WHO's CC BY licence).
export const SOURCE_LABELS: Record<string, string> = {
  who_eml: "WHO Model List of Essential Medicines",
  tga_sssi: "TGA Serious Scarcity Substitution Instrument",
  uk_ssp: "UK Serious Shortage Protocol",
  fda_orange_book: "FDA Orange Book",
  bfarm_alternativpraeparat: "BfArM shortage list (holder-declared alternative)",
};

// Legal authority is jurisdictional: an FDA AB rating doesn't authorise a swap
// in Australia. regulator_authorised labels always name the country.
export function statusLabel(status: AlternativeStatus, publishers: string[], legalScopes: string[] = []): string {
  switch (status) {
    case "regulator_authorised":
      return `Authorised by regulator in ${legalScopes.length ? legalScopes.join(", ") : publishers.join(", ")}`;
    case "verified":
      return `Confirmed by ${publishers.length} independent sources (${publishers.join(", ")})`;
    case "single_source":
      return `Single source (${publishers[0]}) — not independently confirmed`;
  }
}

