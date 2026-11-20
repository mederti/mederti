// Server-only: uses the service-role client.
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { reasonLabel, slugify, type PseoShortageEventWithDrug } from "@/lib/pseo";
import type { AlternativeStatus } from "@/lib/alternatives-sources";
import type { NoticeRow } from "@/app/country/[slug]/medicine-shortages/CountryNotices";

/**
 * Data behind the country profile page beyond the headline summary:
 *   - a pageable, searchable view of the full register (API-backed),
 *   - "what changed this week" (regulator dates only),
 *   - critical shortages with their cited alternatives.
 * Everything here is regulator-published fact; nothing is forecast.
 */

const EVENT_SELECT =
  "id, drug_id, country, country_code, status, severity, reason, reason_category, start_date, end_date, estimated_resolution_date, source_url, last_verified_at, updated_at, data_sources(name, abbreviation, source_url)";

// Same public-page rule as lib/pseo.ts: drop linker-generated synthetic rows.
const REAL = "synthetic.is.null,synthetic.eq.false";

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function toNoticeRow(e: PseoShortageEventWithDrug): NoticeRow {
  const med = e.drugs?.generic_name ?? null;
  return {
    id: e.id,
    medicine: med,
    medicineSlug: med ? slugify(med) : null,
    drugId: e.drug_id,
    status: e.status,
    severity: e.severity,
    reason: reasonLabel(e.reason_category),
    startDate: e.start_date,
    resolutionDate: e.estimated_resolution_date,
    sourceUrl: e.source_url,
    sourceLabel: e.data_sources?.abbreviation ?? e.data_sources?.name ?? "Source",
  };
}

// ─── Full register (search + paging) ────────────────────────────────────────

export const NOTICES_PAGE_SIZE = 50;
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);

export interface NoticesPage {
  rows: NoticeRow[];
  /** Total notices matching the query (not just this page); null if the count failed. */
  total: number | null;
  offset: number;
}

/**
 * One page of a country's open notices (active + anticipated, linked to a
 * medicine), newest start date first. With `q`, matches the medicine's generic
 * name and includes notices that haven't started yet; without it, mirrors the
 * page's "Latest notices" list (already-started only).
 */
export async function countryNoticesPage(
  code: string,
  opts: { q?: string; severity?: string; offset?: number } = {},
): Promise<NoticesPage> {
  const admin = getSupabaseAdmin();
  const offset = Math.max(0, Math.min(opts.offset ?? 0, 20000));
  // Strip PostgREST/LIKE metacharacters — the term is matched as plain text.
  const q = (opts.q ?? "").replace(/[%_,()*\\"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const severity = opts.severity && SEVERITIES.has(opts.severity) ? opts.severity : null;

  let query = admin
    .from("shortage_events")
    .select(`${EVENT_SELECT}, drugs!inner(generic_name)`, { count: "exact" })
    .eq("country_code", code)
    .in("status", ["active", "anticipated"])
    .or(REAL);
  if (q) query = query.ilike("drugs.generic_name", `%${q}%`);
  else query = query.lte("start_date", isoDay(new Date()));
  if (severity) query = query.eq("severity", severity);

  const { data, count, error } = await query
    .order("start_date", { ascending: false, nullsFirst: false })
    .order("id")
    .range(offset, offset + NOTICES_PAGE_SIZE - 1);
  if (error) throw error;
  return {
    rows: ((data ?? []) as unknown as PseoShortageEventWithDrug[]).map(toNoticeRow),
    total: count ?? null,
    offset,
  };
}

// ─── What changed this week ─────────────────────────────────────────────────

export interface WeekItem {
  medicine: string;
  slug: string;
  drugId: string | null;
  /** Notices for this medicine in the bucket (strengths/packs are listed separately). */
  notices: number;
  /** The date that put it in the bucket (start, end, or upcoming start). */
  date: string | null;
}
export interface WeekBucket {
  /** Notices in the window; null if the count failed. */
  notices: number | null;
  /** Distinct medicines, most recent first (capped). */
  items: WeekItem[];
  /** Distinct medicines behind `notices` when all rows were read; else null. */
  medicines: number | null;
}
export interface CountryWeek {
  from: string;
  to: string;
  soonTo: string;
  started: WeekBucket;
  resolved: WeekBucket;
  startingSoon: WeekBucket;
}

const WEEK_ROW_CAP = 400;

function bucket(
  rows: PseoShortageEventWithDrug[],
  count: number | null,
  dateOf: (e: PseoShortageEventWithDrug) => string | null,
): WeekBucket {
  const byMed = new Map<string, WeekItem>();
  for (const e of rows) {
    const name = e.drugs?.generic_name;
    if (!name) continue;
    const hit = byMed.get(name);
    if (hit) hit.notices += 1;
    else byMed.set(name, { medicine: name, slug: slugify(name), drugId: e.drug_id, notices: 1, date: dateOf(e) });
  }
  const complete = count !== null && rows.length >= count;
  return { notices: count, items: [...byMed.values()], medicines: complete ? byMed.size : null };
}

/**
 * Movements over the last 7 days and the next 14, by the regulator's own
 * dates: notices that started, notices the regulator closed (status resolved
 * with an end date in the window — future-dated end dates are estimates and
 * are excluded), and announced notices about to start.
 */
export async function countryWeek(code: string): Promise<CountryWeek> {
  const admin = getSupabaseAdmin();
  const now = new Date();
  const to = isoDay(now);
  const from = isoDay(new Date(now.getTime() - 7 * 864e5));
  const soonTo = isoDay(new Date(now.getTime() + 14 * 864e5));

  const base = () =>
    admin
      .from("shortage_events")
      .select(`${EVENT_SELECT}, drugs!inner(generic_name)`, { count: "exact" })
      .eq("country_code", code)
      .or(REAL);

  const [started, resolved, soon] = await Promise.all([
    base()
      .in("status", ["active", "anticipated"])
      .gte("start_date", from)
      .lte("start_date", to)
      .order("start_date", { ascending: false })
      .limit(WEEK_ROW_CAP),
    base()
      .eq("status", "resolved")
      .gte("end_date", from)
      .lte("end_date", to)
      .order("end_date", { ascending: false })
      .limit(WEEK_ROW_CAP),
    base()
      .in("status", ["active", "anticipated"])
      .gt("start_date", to)
      .lte("start_date", soonTo)
      .order("start_date", { ascending: true })
      .limit(WEEK_ROW_CAP),
  ]);

  const rows = (r: { data: unknown[] | null }) => (r.data ?? []) as unknown as PseoShortageEventWithDrug[];
  const cnt = (r: { count: number | null; error: unknown }) => (r.error ? null : r.count);
  return {
    from,
    to,
    soonTo,
    started: bucket(rows(started), cnt(started), (e) => e.start_date),
    resolved: bucket(rows(resolved), cnt(resolved), (e) => e.end_date),
    startingSoon: bucket(rows(soon), cnt(soon), (e) => e.start_date),
  };
}

// ─── Short medicines × official alternatives ────────────────────────────────

export interface CitedAlternative {
  name: string;
  slug: string;
  drugId: string;
  status: AlternativeStatus;
  /** Publishers stating it, e.g. ["TGA"], ["FDA", "WHO"]. */
  publishers: string[];
  /** A current legal instrument in THIS country authorises it. */
  authorisedHere: boolean;
  sourceUrl: string | null;
  /** Another product of the same medicine (not a different molecule). */
  sameMedicine: boolean;
}
/** A regulator scheme entry that lets a specific product be supplied during the shortage. */
export interface SchemeApproval {
  scheme: string;
  schemeLabel: string;
  product: string;
  expiresAt: string | null;
  sourceUrl: string | null;
}
export interface ShortMedicine {
  medicine: string;
  slug: string;
  drugId: string;
  /** Active notices for this medicine in this country. */
  notices: number;
  critical: boolean;
  approvals: SchemeApproval[];
  alternatives: CitedAlternative[];
}
export interface CountryAlternatives {
  /** false when the evidence tables aren't in this database — say "not available", never "none". */
  evidenceAvailable: boolean;
  /** Distinct medicines with a critical active notice; null if unreadable. */
  criticalMedicines: number | null;
  /** Critical medicines plus any short medicine with an official route here. */
  medicines: ShortMedicine[];
}

// Schemes that authorise supplying an alternative product in a shortage.
// (fda_shortage rows are shortage listings, not alternatives — excluded.)
const SCHEME_LABELS: Record<string, string> = {
  tga_s19a: "TGA Section 19A approved import",
  mhra_ssp: "MHRA Serious Shortage Protocol",
};

// s19A titles arrive as "Approval commences 1 November 2026 - PRODUCT (Country)".
const cleanProduct = (raw: string | null, fallback: string) =>
  (raw ?? "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/^approval commences[^-–]*[-–]\s*/i, "")
    .trim() || fallback;

const chunk = <T,>(a: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

const missingRelation = (err: { code?: string; message?: string } | null) =>
  !!err && (err.code === "42P01" || err.code === "PGRST205" || /does not exist|schema cache/i.test(err.message ?? ""));

/**
 * Medicines short in this country that either carry a critical notice or have
 * an official alternative on file HERE: a regulator scheme approval (TGA
 * s19A, MHRA SSP) or a cited alternative. Legal authority is jurisdictional,
 * so another country's same-medicine equivalents (e.g. FDA Orange Book
 * generics on the Australia page) are not shown.
 */
export async function countryAlternatives(code: string): Promise<CountryAlternatives> {
  const admin = getSupabaseAdmin();
  const today = isoDay(new Date());

  // Active notices → distinct medicines (page past the 1,000-row cap).
  const byDrug = new Map<string, { name: string; notices: number; critical: boolean }>();
  let complete = false;
  for (let from = 0; from < 10000; from += 1000) {
    const { data, error } = await admin
      .from("shortage_events")
      .select("drug_id, severity, drugs!inner(generic_name)")
      .eq("country_code", code)
      .eq("status", "active")
      .or(REAL)
      .order("id")
      .range(from, from + 999);
    if (error || !data) break;
    for (const r of data as unknown as { drug_id: string; severity: string | null; drugs: { generic_name: string } }[]) {
      const hit = byDrug.get(r.drug_id);
      if (hit) {
        hit.notices += 1;
        hit.critical = hit.critical || r.severity === "critical";
      } else byDrug.set(r.drug_id, { name: r.drugs.generic_name, notices: 1, critical: r.severity === "critical" });
    }
    if (data.length < 1000) { complete = true; break; }
  }
  const criticalIds = [...byDrug].filter(([, m]) => m.critical).map(([id]) => id);

  // Scheme approvals in this country, current only.
  const { data: elig } = await admin
    .from("regulatory_eligibility")
    .select("drug_id, brand_name, generic_name, scheme, expires_at, source_url")
    .eq("country_code", code)
    .eq("status", "active")
    .in("scheme", Object.keys(SCHEME_LABELS))
    .or(`expires_at.is.null,expires_at.gte.${today}`)
    .limit(2000);
  const approvals = new Map<string, SchemeApproval[]>();
  for (const e of (elig ?? []) as { drug_id: string | null; brand_name: string | null; generic_name: string | null; scheme: string; expires_at: string | null; source_url: string | null }[]) {
    if (!e.drug_id || !byDrug.has(e.drug_id)) continue;
    const list = approvals.get(e.drug_id) ?? [];
    list.push({
      scheme: e.scheme,
      schemeLabel: SCHEME_LABELS[e.scheme],
      product: cleanProduct(e.brand_name, e.generic_name ?? "Approved product"),
      expiresAt: e.expires_at,
      sourceUrl: e.source_url,
    });
    approvals.set(e.drug_id, list);
  }

  // Cited alternatives: statements made for this country (any short medicine)
  // + all statements for the critical medicines.
  type Ev = { drug_id: string; alternative_drug_id: string; kind: string; publisher: string; authority_type: string; country_code: string | null; source_url: string | null };
  type Pair = { drug_id: string; alternative_drug_id: string; kind: string; verification_status: AlternativeStatus; publishers: string[] | null };
  const evCols = "drug_id, alternative_drug_id, kind, publisher, authority_type, country_code, source_url";
  let evidenceAvailable = true;
  const localIds = new Set<string>();
  {
    const { data, error } = await admin
      .from("alternative_evidence")
      .select("drug_id")
      .eq("country_code", code)
      .or(`valid_until.is.null,valid_until.gte.${today}`)
      .limit(5000);
    if (missingRelation(error)) evidenceAvailable = false;
    for (const r of (data ?? []) as { drug_id: string }[]) if (byDrug.has(r.drug_id)) localIds.add(r.drug_id);
  }

  const candidates = [...new Set([...criticalIds, ...approvals.keys(), ...localIds])];
  const pairs: Pair[] = [];
  const evidence: Ev[] = [];
  if (evidenceAvailable) {
    for (const part of chunk(candidates, 100)) {
      const [p, e] = await Promise.all([
        admin
          .from("verified_alternatives")
          .select("drug_id, alternative_drug_id, kind, verification_status, publishers")
          .in("drug_id", part)
          .limit(2000),
        admin
          .from("alternative_evidence")
          .select(evCols)
          .in("drug_id", part)
          .or(`valid_until.is.null,valid_until.gte.${today}`)
          .or(`valid_from.is.null,valid_from.lte.${today}`)
          .limit(5000),
      ]);
      if (missingRelation(p.error)) { evidenceAvailable = false; break; }
      if (p.error) throw p.error;
      pairs.push(...((p.data ?? []) as unknown as Pair[]));
      evidence.push(...((e.data ?? []) as unknown as Ev[]));
    }
  }

  const altIds = [...new Set(pairs.map((p) => p.alternative_drug_id))];
  const altNames = new Map<string, string>();
  for (const part of chunk(altIds, 200)) {
    const { data } = await admin.from("drugs").select("id, generic_name").in("id", part);
    for (const d of (data ?? []) as { id: string; generic_name: string }[]) altNames.set(d.id, d.generic_name);
  }

  const STATUS_ORDER: Record<AlternativeStatus, number> = { regulator_authorised: 0, verified: 1, single_source: 2 };
  const medicines: ShortMedicine[] = candidates.map((id) => {
    const m = byDrug.get(id)!;
    const alternatives = pairs
      .filter((p) => p.drug_id === id && altNames.has(p.alternative_drug_id))
      .map((p) => {
        const ev = evidence.filter((e) => e.drug_id === id && e.alternative_drug_id === p.alternative_drug_id && e.kind === p.kind);
        const authorisedHere = ev.some((e) => e.authority_type === "regulator_legal" && e.country_code === code);
        const local = ev.find((e) => e.country_code === code);
        const name = altNames.get(p.alternative_drug_id)!;
        return {
          name,
          slug: slugify(name),
          drugId: p.alternative_drug_id,
          status: p.verification_status,
          // Only the publishers whose statements apply here or globally.
          publishers: [...new Set(ev.filter((e) => !e.country_code || e.country_code === code).map((e) => e.publisher))],
          authorisedHere,
          sourceUrl: (local ?? ev.find((e) => !e.country_code) ?? ev[0])?.source_url ?? null,
          sameMedicine: p.alternative_drug_id === id,
          _applies: ev.some((e) => !e.country_code || e.country_code === code),
        };
      })
      // Another country's statement about the same medicine isn't an option here.
      .filter((a) => a._applies)
      .map((a): CitedAlternative => ({
        name: a.name, slug: a.slug, drugId: a.drugId, status: a.status, publishers: a.publishers,
        authorisedHere: a.authorisedHere, sourceUrl: a.sourceUrl, sameMedicine: a.sameMedicine,
      }))
      .sort(
        (a, b) =>
          Number(b.authorisedHere) - Number(a.authorisedHere) ||
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          a.name.localeCompare(b.name),
      );
    return {
      medicine: m.name,
      slug: slugify(m.name),
      drugId: id,
      notices: m.notices,
      critical: m.critical,
      approvals: approvals.get(id) ?? [],
      alternatives,
    };
  });

  // Official route here first, then other cited alternatives, then none.
  const rank = (m: ShortMedicine) =>
    m.approvals.length || m.alternatives.some((a) => a.authorisedHere) ? 0 : m.alternatives.length ? 1 : 2;
  medicines.sort(
    (a, b) => rank(a) - rank(b) || Number(b.critical) - Number(a.critical) || a.medicine.localeCompare(b.medicine),
  );

  return { evidenceAvailable, criticalMedicines: complete ? criticalIds.length : null, medicines };
}
