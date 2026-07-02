// Alternatives are a directional hint to raise with a prescriber — NOT a clinical
// equivalence claim and NOT medical advice. We deliberately never surface a hard
// percentage ("65% match" reads as a precise, validated equivalence score, which
// it is not). Map the internal similarity score to a soft, suggestive band instead.
export function affinity(pct?: number | null): string | null {
  if (pct == null) return null;
  if (pct >= 75) return "Closely related";
  if (pct >= 55) return "Related option";
  if (pct >= 35) return "Same class";
  return "Worth discussing";
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
      return "Same active ingredient";
    case "biosimilar":
      return "Biosimilar — not automatically interchangeable";
    case "pharmacological_alternative":
      return "Different medicine — prescriber must approve";
    case "therapeutic_class_alternative":
      return "Different medicine, same class — prescriber must approve";
    case "":
      return "Relationship unverified — confirm with prescriber";
    default:
      return rel as string;
  }
}
