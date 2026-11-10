// Every alternative currently on file comes from one automated source: two drugs
// sharing a WHO ATC classification prefix (backend/importers/alternatives_importer.py).
// No clinician or regulator has reviewed them. So the only true thing we can say
// about a pair is HOW MUCH of the ATC code they share — never a "% match",
// evidence grade, dose ratio or "safe to dispense" claim. Those were derived from
// the ATC level by a fixed lookup, not from evidence, and must not be shown.
export const ALTERNATIVES_SOURCE = "WHO ATC classification";
export const ALTERNATIVES_CAVEAT =
  "Same-class context from the WHO ATC classification only — not a clinical substitution recommendation, " +
  "not reviewed by a pharmacist, and not dose-equivalent. Form, strength, route and indication may differ. " +
  "Confirm any switch with a prescriber.";

// atc_match_level = how many ATC levels the two drugs share (the importer cuts
// the code at 3/4/5/7 chars for levels 2/3/4/5). Labels name the level and,
// when an ATC code is passed, the shared prefix itself (e.g. "J01C") so the
// claim is checkable against the WHO ATC index.
const ATC_CUT: Record<number, number> = { 2: 3, 3: 4, 4: 5, 5: 7 };
export function atcMatchLabel(level?: number | null, atcCode?: string | null): string | null {
  if (level == null || !ATC_CUT[level]) return null;
  const prefix = atcCode && atcCode.length >= ATC_CUT[level] ? ` (${atcCode.slice(0, ATC_CUT[level])})` : "";
  return level === 5 ? `Same ATC code${prefix}` : `Same ATC level-${level} group${prefix}`;
}

// Legacy callers pass the stored similarity_score × 100. That score is a fixed
// function of the ATC level (95/80/65/50), so map it back to the ATC wording
// rather than a "closeness" band that implies clinical judgement.
export function affinity(pct?: number | null): string | null {
  if (pct == null) return null;
  if (pct >= 90) return atcMatchLabel(5);
  if (pct >= 75) return atcMatchLabel(4);
  if (pct >= 60) return atcMatchLabel(3);
  return atcMatchLabel(2);
}

// drug_alternatives.relationship_type → what a pharmacist needs to know: is this
// a like-for-like swap, or a different medicine that needs a prescriber? Accepts
// the raw enum ("therapeutic_equivalent") or its spaced display form. An unknown
// or missing relationship is said to be unknown — never assumed substitutable.
export function relationshipLabel(rel?: string | null): string {
  const key = (rel ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  switch (key) {
    case "generic":
      return "Same medicine — different brand";
    case "therapeutic_equivalent":
      // ATC level 5 = same substance code; salt, form, strength and route can still differ.
      return "Same ATC substance — check form, strength and route";
    case "biosimilar":
      return "Same ATC class (biologic) — not a biosimilar determination";
    case "pharmacological_alternative":
      return "Different medicine, same ATC subgroup — prescriber must approve";
    case "therapeutic_class_alternative":
      return "Different medicine, same ATC class — prescriber must approve";
    case "":
      return "Relationship unverified — confirm with prescriber";
    default:
      return rel as string;
  }
}
