// Strict molecule grouping for the substitution engine. `drugs` is
// fragmented: the canonical "Diltiazem" row has no AU notices while
// "Diltiazem-Hydrochloride" holds them. A row belongs to the molecule only when
// its whole name, minus salt / hydrate words, IS the molecule name. Nothing
// fuzzy: brand rows ("Revonto (Dantrolene Sodium For Injection)"), other
// languages ("Diltiazemhydrochlorid") and combinations never match.

const SALT_WORDS = new Set([
  "hydrochloride", "hcl", "hydrobromide", "sodium", "potassium", "calcium", "magnesium",
  "sulfate", "sulphate", "phosphate", "citrate", "maleate", "mesylate", "mesilate",
  "besylate", "besilate", "tartrate", "bitartrate", "acetate", "succinate", "fumarate",
  "bromide", "chloride", "nitrate", "lactate", "gluconate", "tosylate", "tosilate",
  "dihydrogen", "disodium", "trihydrate", "dihydrate", "monohydrate", "hemihydrate",
  "hemiheptahydrate", "sesquihydrate", "hydrate", "anhydrous", "as",
]);

export function moleculeKey(name: string | null): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[^a-z ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !SALT_WORDS.has(w))
    .join(" ");
}

// The molecule name a whole-word search can use, or null when stripping salt
// words leaves too little to be safe ("potassium chloride" → "").
export function searchableMolecule(name: string | null): string | null {
  const k = moleculeKey(name);
  return k.length >= 4 ? k : null;
}

export function sameMolecule(rowName: string | null, molecule: string): boolean {
  return moleculeKey(rowName) === molecule;
}

// A regulator listing title names this molecule as its only active
// ingredient: the molecule appears as whole words and the title doesn't join
// several ingredients ("Efavirenz, Emtricitabine and Tenofovir …").
export function titleNamesMolecule(title: string | null, molecule: string): boolean {
  const t = (title ?? "").toLowerCase().replace(/[-_]/g, " ");
  const esc = molecule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`(^|[^a-z])${esc}([^a-z]|$)`).test(t)) return false;
  return !/\s(and|&|\+)\s|[a-z],\s*[a-z]{4,}\b(?!\s*\d)/.test(t);
}
