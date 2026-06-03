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
