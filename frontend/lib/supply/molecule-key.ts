/**
 * Molecule identity for FDA DMF substance names and drug record names.
 *
 * One molecule's DMFs are filed under several salt, ester and grade names
 * ("montelukast sodium", "olmesartan medoxomil usp", "acetaminophen dc90-10
 * sd") and US names (acetaminophen = paracetamol). moleculeKey() reduces a
 * name to one key so those rows count together. Pure — safe to import from
 * pages and route handlers alike.
 */
// ── Molecule key ───────────────────────────────────────────────────────────
// Trailing words that change the salt, hydrate, grade or form, not the molecule.
const STRIP_WORDS = new Set([
  "sodium", "potassium", "calcium", "magnesium", "zinc", "hydrochloride", "hcl", "dihydrochloride", "hydrobromide",
  "bromide", "chloride", "mesylate", "mesilate", "besylate", "besilate", "maleate", "fumarate", "hemifumarate",
  "succinate", "tartrate", "bitartrate", "citrate", "acetate", "sulfate", "sulphate", "bisulfate", "phosphate",
  "nitrate", "lactate", "tosylate", "trihydrate", "monohydrate", "dihydrate", "hemihydrate", "sesquihydrate",
  "hydrate", "anhydrous", "disodium", "dipotassium", "palmitate", "hyclate", "gluconate", "malate", "oxalate",
  "xinafoate", "furoate", "pamoate", "embonate", "stearate", "benzoate", "salicylate", "propionate", "dipropionate",
  "valerate", "tromethamine", "trometamol", "meglumine", "micronized", "micronised", "sterile", "usp", "ep", "bp",
  "jp", "ph", "eur", "powder", "granules", "granular", "crystalline", "crystals", "amorphous", "base", "compacted",
  "dc", "sd", "grade", "form", "non-sterile", "nonsterile", "milled", "coated", "api", "cypionate", "enanthate",
  "undecanoate", "decanoate", "phenylpropionate", "caproate", "napsylate", "esylate", "edisylate", "carbonate",
  "hydroxide", "lysine", "arginine", "bisulphate", "dimesylate", "polymorph", "in-house", "ih", "drug", "substance",
  // Prodrug esters the drug record usually omits ("Olmesartan" vs the DMF's
  // "olmesartan medoxomil"; 30 holders were hiding under the ester name).
  "medoxomil", "cilexetil", "axetil", "proxetil", "pivoxil", "mofetil", "etexilate",
]);
// A key that is only one of these ("sodium" from "sodium chloride") would merge
// unrelated substances; keep the full name instead.
const ELEMENT_WORDS = new Set([
  "sodium", "potassium", "calcium", "magnesium", "zinc", "iron", "ferrous", "ferric", "aluminium", "aluminum",
  "silver", "bismuth", "copper", "cupric", "selenium", "gold", "barium", "strontium", "chromium", "manganese", "cobalt",
]);

// FDA data uses US names; drugs and other regulators mostly use INNs. Official,
// unambiguous same-substance pairs (backend/importers/alternatives_resolver.py
// INN_TO_USAN + backend/analysis/risk_score.py INN_USAN_EXTRA), USAN → INN.
const USAN_TO_INN: Record<string, string> = {
  beclomethasone: "beclometasone", chlorthalidone: "chlortalidone", ergonovine: "ergometrine",
  leuprolide: "leuprorelin", methicillin: "meticillin", norethindrone: "norethisterone", albuterol: "salbutamol",
  acetaminophen: "paracetamol", glyburide: "glibenclamide", epinephrine: "adrenaline", norepinephrine: "noradrenaline",
  acyclovir: "aciclovir", valacyclovir: "valaciclovir", "penicillin g": "benzylpenicillin", "penicillin v": "phenoxymethylpenicillin",
  cyclosporine: "ciclosporin", rifampin: "rifampicin", cholecalciferol: "colecalciferol", cephalexin: "cefalexin",
  cephalothin: "cefalotin", succinylcholine: "suxamethonium", methimazole: "thiamazole", isoproterenol: "isoprenaline",
  meperidine: "pethidine", cromolyn: "cromoglicic acid", thioguanine: "tioguanine", clomiphene: "clomifene",
  phytonadione: "phytomenadione", "methylene blue": "methylthioninium chloride", leucovorin: "folinic acid",
  nitroglycerin: "glyceryl trinitrate", chlorpheniramine: "chlorphenamine", vasopressin: "argipressin",
  aspirin: "acetylsalicylic acid", dextroamphetamine: "dexamfetamine", "amphotericin b": "amfotericin b",
  nitroprusside: "sodium nitroprusside", "ethinyl estradiol": "ethinylestradiol",
};

const COMBO = /\s(and|with|&|\+)\s|[+;/,]|\bcomposite\b/i;
// "A Hcl-B Hcl-C" style compounding names: 3+ hyphen-joined parts.
export const looksCombo = (n: string) => COMBO.test(n) || n.split("-").length >= 3;


/** Molecule key for a substance or drug name, or null for a combination. */
export function moleculeKey(raw: string | null | undefined): string | null {
  let n = (raw ?? "").toLowerCase().replace(/\([^)]*\)?/g, " ").replace(/\s+/g, " ").trim();
  if (!n || looksCombo(n)) return null;
  const full = n;
  const tokens = n.split(" ");
  while (tokens.length > 1) {
    const t = tokens[tokens.length - 1];
    if (STRIP_WORDS.has(t) || /\d/.test(t) || t.length <= 1 || t.startsWith("form-")) tokens.pop();
    else break;
  }
  n = tokens.join(" ");
  if (ELEMENT_WORDS.has(n)) n = full;
  return USAN_TO_INN[n] ?? n;
}

// Corporate-suffix noise stripped when de-duplicating holder names
// (same rule as backend/analysis/risk_score.py norm_firm).
const FIRM_SUFFIX = /\b(inc|llc|ltd|limited|corp|corporation|co|company|gmbh|sa|spa|srl|ag|plc|lp|pty|usa|labs?|laboratories|pharmaceuticals?|pharma|healthcare|industries|group|international|us)\b/g;
export const normFirm = (n: string) => n.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(FIRM_SUFFIX, " ").replace(/\s+/g, " ").trim();

/** The name prefixes a molecule's rows are filed under: its key and any US name. */
export function moleculeNameVariants(key: string): string[] {
  return [key, ...Object.entries(USAN_TO_INN).filter(([, inn]) => inn === key).map(([usan]) => usan)];
}
