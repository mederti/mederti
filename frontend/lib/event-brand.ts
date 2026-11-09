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

// Market-exit facts a regulator states on a discontinuation notice. Only
// TGA exposes these today: `deleted_date` on a 'D' record is the ARTG
// cancellation date (the product's legal last day on the market) and
// `shortage_impact` is TGA's own impact rating, which our availability-led
// severity can disagree with — so it is surfaced verbatim, never re-derived.
export type EventMarketExit = { withdrawal_date: string | null; regulator_impact: string | null };

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** TGA "31 Mar 2027" → "2027-03-31"; anything else → null (never guessed). */
function tgaDate(v: unknown): string | null {
  const m = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(String(v ?? "").trim());
  const mm = m && MONTHS[m[2].toLowerCase()];
  return m && mm ? `${m[3]}-${mm}-${m[1].padStart(2, "0")}` : null;
}

export function extractEventMarketExit(
  dataSourceId: string | null | undefined,
  rawData: unknown,
): EventMarketExit {
  const raw = (rawData && typeof rawData === "object" ? rawData : {}) as Record<string, unknown>;
  if (dataSourceId !== SRC_TGA || raw.status !== "D") return { withdrawal_date: null, regulator_impact: null };
  return { withdrawal_date: tgaDate(raw.deleted_date), regulator_impact: clean(raw.shortage_impact) };
}
