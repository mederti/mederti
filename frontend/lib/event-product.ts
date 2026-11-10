// Product description + normalised dose form for one regulator notice,
// derived from shortage_events.raw_data (keys differ per regulator: TGA
// `dose_form`, Health Canada `dosage_form`, HSA `product_name`, FAMHP
// `prescriptionName`, PMDA Japanese names …). The concatenated text is
// classified rather than trusting one field. Strength is not normalised —
// formats vary too much across regulators to split on honestly.
//
// Server-side only: raw_data is heavy and must not reach client components.

export type Form = "tablet" | "capsule" | "oral_liquid" | "injection" | "topical" | "inhaled" | "other";

export const FORM_LABELS: Record<Form, string> = {
  tablet: "Tablet", capsule: "Capsule", oral_liquid: "Oral liquid", injection: "Injection",
  topical: "Topical", inhaled: "Inhaled", other: "Other / not stated",
};
// Order matters: an injection "powder for solution" must not read as oral
// liquid, and "film-coated tablet" must not read as capsule.
const FORM_RULES: [Form, RegExp][] = [
  ["injection", /inject|infusion|\bvial|ampoule|ampul|intraven|\bi\.?v\.?\b|syringe|parenteral|\binj\b|注射|点滴/],
  ["inhaled", /inhal|nebul|aerosol|\bpuff|吸入/],
  ["topical", /cream|ointment|\bgel\b|lotion|transdermal|\bpatch|topical|eye drop|ear drop|ophthalm|軟膏|クリーム|点眼|貼付/],
  ["oral_liquid", /suspension|\bsusp\b|syrup|oral solution|oral liquid|elixir|\bdrops?\b|sachet|granul|powder for oral|シロップ|散|顆粒|内用液/],
  ["capsule", /capsul|\bcaps?\b|kaps|カプセル/],
  ["tablet", /tablet|\btabs?\b|\btabl\b|comprim|tablett|filmtab|\btbl\b|錠/],
];

// raw_data keys that usually hold a human product description, most specific
// first. Falls back to any key containing product/trade/brand/name.
const PRODUCT_KEYS = [
  "trade_names", "product_name", "prescriptionName", "presentation", "brand_name",
  "name", "drug_name", "product", "description", "medicine", "title",
];

function textOf(raw: Record<string, unknown> | null): string {
  if (!raw) return "";
  return Object.values(raw)
    .filter((v) => typeof v === "string" || typeof v === "number")
    .join(" ")
    .toLowerCase();
}

export function formOf(raw: Record<string, unknown> | null): Form {
  const t = textOf(raw);
  for (const [f, re] of FORM_RULES) if (re.test(t)) return f;
  return "other";
}

export function productOf(raw: Record<string, unknown> | null): string | null {
  if (!raw) return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  let name: string | null = null;
  for (const k of PRODUCT_KEYS) {
    name = str(raw[k]);
    if (name) break;
  }
  if (!name) {
    const k = Object.keys(raw).find((key) => /product|trade|brand|name/i.test(key) && str(raw[key]));
    name = k ? str(raw[k]) : null;
  }
  if (!name) return null;
  const strength = str(raw.strength);
  if (strength && !name.toLowerCase().includes(strength.toLowerCase())) name = `${name} ${strength}`;
  return name.length > 90 ? `${name.slice(0, 87)}…` : name;
}
