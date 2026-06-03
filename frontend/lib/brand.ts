/**
 * Brand-name normalisation.
 *
 * National drug registries store "brand" strings as full product descriptions —
 * strength, dosage form, pack size and packaging material all jammed together
 * and usually ALL-CAPS, e.g.
 *
 *   "ATORVASTATINA ALTER GENERICOS 30 MG COMPRIMIDOS RECUBIERTOS CON PELICULA,
 *    28 comprimidos (PVC/PVDC/PVC-Aluminio)"
 *
 * As a label that is unreadable — the recognisable name is just the leading
 * words ("Atorvastatina Alter Genericos"). These helpers trim to that.
 *
 * READ-PATH ONLY. We deliberately do not overwrite the stored `drugs.brand_names`
 * column: the raw strings power exact-array lookups (admin naming graph's
 * `.contains()`) and product-image search, and carry registry detail worth
 * keeping. Clean at display time, everywhere brands are shown.
 */

// Dosage-form / filler words to strip from the tail, multilingual (EN/DE/ES/FR/IT).
const FORM_WORDS =
  /\b(?:film|coated|tablett?en?|tablets?|comprimid[oa]s?|comprim[eé]s?|capsul[ea]s?|kapseln?|c[aá]psulas?|recubiert[oa]s?|pelicula|p[eé]l[ií]cula|con|de|la|injection|injectable|solution|soluci[oó]n|suspension|sirup|syrup|oral|hard|soft|prolonged|release|efg|efervescentes?|granul[ea]s?|powder|polvo|sachets?|vials?|ampoules?|ampollas?)\b/i;

/** Trim one raw registry product string down to its recognisable brand label. */
export function cleanBrand(raw: string): string {
  let s = (raw || "").trim();
  if (!s) return "";
  s = s.replace(/\([^)]*\)/g, " ");                                                       // drop parenthetical packaging
  s = s.replace(/\b\d[\d.,]*\s*(?:mg|mcg|µg|ug|g|ml|l|%|iu|ie|ui|kbq|mbq)\b.*$/i, " ");     // cut from strength onward
  s = s.replace(/(?:,\s*)?\b\d[\d.,/]*\b(?=\s*\p{L}).*$/iu, " ");                           // cut a leftover pack count
  let prev = "";
  while (s !== prev) { prev = s; s = s.replace(new RegExp(FORM_WORDS.source + "[\\s,;.]*$", "i"), " ").trim(); }
  s = s.replace(/[\s,;.]+$/g, "").trim();
  if (s && s === s.toUpperCase()) s = s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase()); // title-case ALL-CAPS
  return s;
}

/**
 * Clean, de-INN, dedupe and rank a raw `brand_names` array for display.
 * Crispest names first (short clean brands like "Lipitor" beat long leftovers).
 */
export function cleanBrandNames(raw: string[] | null | undefined, generic?: string | null): string[] {
  const genericLc = (generic ?? "").trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw ?? []) {
    const c = cleanBrand(r);
    if (!c) continue;
    const lc = c.toLowerCase();
    if (lc === genericLc || seen.has(lc)) continue;
    seen.add(lc);
    out.push(c);
  }
  return out.sort((a, b) => a.length - b.length || a.localeCompare(b));
}
