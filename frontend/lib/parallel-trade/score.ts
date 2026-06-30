/**
 * Parallel-trade match scoring — TypeScript port of the canonical ladder.
 *
 * SOURCE OF TRUTH is backend/scrapers/parallel_trade/matching.py (the connectors
 * write the score at ingest time). This port exists ONLY so the recalculate
 * endpoint can re-score existing (drug, licence) pairs against current drug
 * facts without a round-trip to Python. Keep the two in sync; if you change a
 * tier here, change it there.
 */

export const REVIEW_THRESHOLD = 0.65;

export interface ScoreLicence {
  brand_name?: string | null;
  strength?: string | null;
  dosage_form?: string | null;
  pack_size?: string | null;
  reference_ma_number?: string | null;
}

export interface DrugFacts {
  generic_name?: string;
  brand_names?: string[] | null;
  strengths?: string[] | null;
  dosage_forms?: string[] | null;
  pack_sizes?: string[] | null;
  ma_numbers?: string[] | null;
}

function norm(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase().replace(/[\s\-_/.,()]+/g, " ").replace(/\s+/g, " ").trim();
}

function normStrength(s: string | null | undefined): string {
  const n = norm(s);
  return n
    .replace(/ mg/g, "mg")
    .replace(/ mcg/g, "mcg")
    .replace(/ ml/g, "ml")
    .replace(/ g/g, "g");
}

function anyMatch(
  value: string | null | undefined,
  candidates: string[] | null | undefined,
  normaliser: (s: string | null | undefined) => string = norm
): boolean {
  if (!value || !candidates || candidates.length === 0) return false;
  const v = normaliser(value);
  if (!v) return false;
  return candidates.some((c) => {
    const cn = normaliser(c);
    return !!cn && (v === cn || v.includes(cn) || cn.includes(v));
  });
}

/**
 * Score a resolved (drug, licence) pair. Call only when the licence is already
 * linked to the drug — that molecule link is the INN corroboration (0.50 floor).
 */
export function scoreMatch(
  licence: ScoreLicence,
  facts: DrugFacts
): { confidence: number; basis: string[] } {
  const basis: string[] = ["inn"];

  const brandOk = anyMatch(licence.brand_name, facts.brand_names);
  const strengthOk = anyMatch(licence.strength, facts.strengths, normStrength);
  const formOk = anyMatch(licence.dosage_form, facts.dosage_forms);
  const packOk = anyMatch(licence.pack_size, facts.pack_sizes);
  const maOk = anyMatch(licence.reference_ma_number, facts.ma_numbers);

  if (brandOk) basis.push("brand");
  if (strengthOk) basis.push("strength");
  if (formOk) basis.push("dosage_form");
  if (packOk) basis.push("pack_size");
  if (maOk) basis.push("ma_number");

  let confidence = 0.5;
  if (brandOk && strengthOk && formOk && packOk && maOk) confidence = 1.0;
  else if (brandOk && strengthOk && formOk) confidence = 0.9;
  else if (strengthOk && formOk && packOk) confidence = 0.8;
  else if (strengthOk && formOk) confidence = 0.65;

  return { confidence, basis };
}
