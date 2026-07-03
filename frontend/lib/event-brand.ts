// Per-event product identity (brand + sponsor), extracted from the regulator
// record preserved verbatim in shortage_events.raw_data. Nothing is inferred:
// sources that report at ingredient level only (MHRA and most others) return
// nulls and the UI must label those rows ingredient-level — never decorate
// them with drugs.brand_names, which spans ALL brands of the molecule.
//
// This is the TS mirror of backend/scripts/backfill_event_brands.py (which
// writes the same extraction into first-class columns once migration 068 is
// applied — keep the two in sync). Extracting from raw_data here means the
// display works before the migration/backfill run; switch reads to the
// columns once they are live everywhere.
//
// Call SERVER-SIDE only, and strip raw_data before events reach a client
// component — regulator records are heavy and would bloat the RSC payload.

export type EventBrand = { brand_name: string | null; sponsor: string | null };

const SRC_FDA = "10000000-0000-0000-0000-000000000001";
const SRC_HEALTH_CANADA = "10000000-0000-0000-0000-000000000002";
const SRC_TGA = "10000000-0000-0000-0000-000000000003";
const SRC_EMA = "10000000-0000-0000-0000-000000000005";

const EMA_BRAND_KEYS = ["medicine_affected", "medicine affected", "medicine name"];
const EMA_MAH_KEYS = [
  "marketing_authorisation_holder_s", "marketing_authorisation_holder",
  "marketing authorisation holder", "mah", "MAH", "holder",
  "Marketing Authorisation Holder",
];

function clean(v: unknown): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) v = v[0] ?? null;
  const s = String(v ?? "").trim();
  if (!s || ["n/a", "none", "unknown", "-"].includes(s.toLowerCase())) return null;
  return s.slice(0, 300);
}

function probe(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    if (k in raw) {
      const got = clean(raw[k]);
      if (got) return got;
    }
  }
  return null;
}

export function extractEventBrand(
  dataSourceId: string | null | undefined,
  rawData: unknown,
): EventBrand {
  const raw = (rawData && typeof rawData === "object" ? rawData : {}) as Record<string, unknown>;
  switch (dataSourceId) {
    case SRC_TGA:
      return { brand_name: clean(raw.trade_names), sponsor: clean(raw.sponsor) };
    case SRC_HEALTH_CANADA:
      return { brand_name: clean(raw.brand_name), sponsor: clean(raw.company_name) };
    case SRC_FDA:
      // FDA shortage records are generic+company keyed; raw_data has no brand.
      return { brand_name: null, sponsor: clean(raw.company_name) };
    case SRC_EMA:
      return { brand_name: probe(raw, EMA_BRAND_KEYS), sponsor: probe(raw, EMA_MAH_KEYS) };
    default:
      return { brand_name: null, sponsor: null };
  }
}
