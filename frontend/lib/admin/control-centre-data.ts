import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Aggregation pass for the CEO control centre (/admin/control-centre).
 *
 * Everything here is real: Supabase counts, data_sources freshness, auth
 * users. Panels whose backing system isn't wired (traffic, Stripe
 * revenue) report { available: false } so the UI renders an honest
 * "not connected" state instead of fabricated numbers.
 *
 * Traffic comes from the Vercel Web Analytics query API when
 * VERCEL_ANALYTICS_TOKEN is set (PostHog HogQL is a fallback).
 *
 * Called only from the admin-gated route handler — never expose without
 * requireAdmin().
 */

const STALE_GRACE_HOURS = 12;

const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia", US: "United States", GB: "United Kingdom", CA: "Canada",
  DE: "Germany", FR: "France", IT: "Italy", ES: "Spain", NL: "Netherlands",
  BE: "Belgium", IE: "Ireland", PT: "Portugal", GR: "Greece", AT: "Austria",
  CH: "Switzerland", FI: "Finland", NO: "Norway", SE: "Sweden", DK: "Denmark",
  NZ: "New Zealand", SG: "Singapore", HK: "Hong Kong", JP: "Japan",
  KR: "South Korea", BR: "Brazil", MX: "Mexico", AR: "Argentina",
  ZA: "South Africa", NG: "Nigeria", SA: "Saudi Arabia", AE: "UAE",
  TR: "Turkey", PL: "Poland", HU: "Hungary", CZ: "Czech Republic",
  SK: "Slovakia", MY: "Malaysia", IN: "India", CN: "China", EU: "EU (EMA)",
  SI: "Slovenia", IS: "Iceland", BA: "Bosnia & Herz.", TH: "Thailand",
  CO: "Colombia", HR: "Croatia", LV: "Latvia", RO: "Romania", LT: "Lithuania",
  EE: "Estonia", PE: "Peru", SN: "Senegal", TW: "Taiwan", LK: "Sri Lanka",
};

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Run async tasks with bounded concurrency — Supabase statement timeouts
 *  showed up when ~30 count queries were fired at once. */
async function batched<T>(tasks: (() => Promise<T>)[], limit = 6): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]();
      }
    }),
  );
  return results;
}

/** Seed/test accounts (mederti.test) and staff (mederti.com). These are real
 *  auth rows but not customers — every user-facing metric excludes them and
 *  reports them separately, so "users" always means external people. */
const INTERNAL_EMAIL_DOMAINS = ["mederti.test", "mederti.com"];
export function isInternalEmail(email: string | null): boolean {
  const domain = (email ?? "").split("@")[1]?.toLowerCase() ?? "";
  return INTERNAL_EMAIL_DOMAINS.includes(domain);
}

/** shortage_events.synthetic marks rows that are not regulator shortage
 *  notices (e.g. FDA MedWatch recalls stored as events). The public site
 *  excludes them everywhere, so the control centre must too. */
const NOT_SYNTHETIC = "synthetic.is.null,synthetic.eq.false";

function maskEmail(email: string | null): string {
  if (!email) return "unknown";
  const [local, domain] = email.split("@");
  if (!domain) return "unknown";
  return `${local.slice(0, 1)}•••@${domain}`;
}

interface ProfileRow {
  user_id: string;
  role: string | null;
  created_at: string | null;
  countries: string[] | null;
}

async function fetchAllProfiles(admin: ReturnType<typeof getSupabaseAdmin>) {
  const profiles: ProfileRow[] = [];
  const pageSize = 1000;
  for (let page = 0; page <= 50; page++) {
    const { data, error } = await admin
      .from("user_profiles")
      .select("user_id, role, created_at, countries")
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw new Error(error.message);
    profiles.push(...((data ?? []) as ProfileRow[]));
    if (!data || data.length < pageSize) break;
  }
  return profiles;
}

interface AuthUserLite {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
}

async function fetchAllAuthUsers(admin: ReturnType<typeof getSupabaseAdmin>) {
  const users: AuthUserLite[] = [];
  for (let p = 1; p <= 20; p++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: p, perPage: 1000 });
    // Never return a partial list — user counts would silently under-report.
    if (error) throw new Error(`auth.admin.listUsers failed: ${error.message}`);
    users.push(
      ...data.users.map((u) => ({
        id: u.id,
        email: u.email ?? null,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
      })),
    );
    if (data.users.length < 1000) break;
  }
  return users;
}

export type NamedCount = { name: string; value: number; code?: string };

/** Countries behind the Nov 2026 crawler spike (thousands of visits, zero
 *  signups). Vercel Web Analytics cannot separate bots from people, so we
 *  never subtract these — we report their share next to the total. */
export const CRAWLER_HEAVY_COUNTRIES = ["SG", "CN", "HK"];

export type TrafficData =
  | { available: false; reason: string }
  | {
      available: true;
      source: "vercel" | "posthog";
      window_days: number;
      daily: { date: string; visitors: number; views: number | null }[];
      /** De-duplicated across the whole window (not a sum of daily uniques). */
      visitors_total: number;
      views_total: number | null;
      top_pages: NamedCount[];
      top_referrers: NamedCount[];
      top_countries: NamedCount[];
      /** Visitors from CRAWLER_HEAVY_COUNTRIES that appear in top_countries. */
      crawler_heavy_visitors: number;
    };

const TRAFFIC_WINDOW_DAYS = 90;

/**
 * Vercel Web Analytics — the primary traffic source. <Analytics /> has been
 * in the root layout since launch (cookieless, so not consent-gated), and
 * the public query API exposes the same numbers as the Vercel dashboard.
 *
 * Needs VERCEL_ANALYTICS_TOKEN (a Vercel access token scoped to the team).
 * Project/team IDs default to the mederti project; override via env.
 */
async function fetchVercelTraffic(): Promise<TrafficData | null> {
  const token = process.env.VERCEL_ANALYTICS_TOKEN;
  if (!token) return null;
  const projectId = process.env.VERCEL_ANALYTICS_PROJECT_ID || "prj_YEn45c67WshFBA6D6jP6NwkYBwk5";
  const teamId = process.env.VERCEL_ANALYTICS_TEAM_ID || "team_fwNsQpnIDnvi9VPRfxPf03QH";
  const base = "https://api.vercel.com/v1/query/web-analytics/visits";

  const DAY = 86_400_000;
  const today = new Date();
  const since = new Date(today.getTime() - (TRAFFIC_WINDOW_DAYS - 1) * DAY);
  // by=day is capped at 62 days per request, so the daily series is two halves.
  const mid = new Date(since.getTime() + 45 * DAY);

  type Row = Record<string, string | number | null> & { pageviews?: number; visitors?: number };
  const get = async (endpoint: "count" | "aggregate", params: Record<string, string>) => {
    const qs = new URLSearchParams({ projectId, teamId, ...params });
    const res = await fetch(`${base}/${endpoint}?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 600 },
    });
    if (!res.ok) throw new Error(`Vercel Analytics HTTP ${res.status}`);
    return ((await res.json()) as { data: unknown }).data;
  };
  const top = async (by: string, label: (v: string) => string = (v) => v) =>
    ((await get("aggregate", { by, since: dayKey(since), until: dayKey(today), limit: "9" })) as Row[])
      .filter((r) => r[by] && r[by] !== "Others")
      .slice(0, 8)
      .map((r) => ({ name: label(String(r[by])), value: Number(r.visitors ?? 0), code: String(r[by]) }));

  try {
    const [totals, firstHalf, secondHalf, top_pages, top_referrers, top_countries] = await Promise.all([
      get("count", { since: dayKey(since), until: dayKey(today) }) as Promise<Row>,
      get("aggregate", { by: "day", since: dayKey(since), until: dayKey(new Date(mid.getTime() - DAY)), limit: "100" }) as Promise<Row[]>,
      get("aggregate", { by: "day", since: dayKey(mid), until: dayKey(today), limit: "100" }) as Promise<Row[]>,
      top("requestPath"),
      top("referrerHostname"),
      top("country", (c) => COUNTRY_NAMES[c] ?? c),
    ]);

    const byDay = new Map<string, Row>();
    for (const r of [...firstHalf, ...secondHalf]) byDay.set(String(r.timestamp).slice(0, 10), r);
    const daily: { date: string; visitors: number; views: number | null }[] = [];
    for (let t = since.getTime(); t <= today.getTime(); t += DAY) {
      const key = dayKey(new Date(t));
      const r = byDay.get(key);
      daily.push({ date: key, visitors: Number(r?.visitors ?? 0), views: Number(r?.pageviews ?? 0) });
    }

    return {
      available: true,
      source: "vercel",
      window_days: TRAFFIC_WINDOW_DAYS,
      daily,
      visitors_total: Number(totals.visitors ?? 0),
      views_total: Number(totals.pageviews ?? 0),
      top_pages,
      top_referrers,
      top_countries,
      crawler_heavy_visitors: crawlerHeavy(top_countries),
    };
  } catch (e) {
    return { available: false, reason: `Vercel Analytics query failed: ${(e as Error).message}.` };
  }
}

const crawlerHeavy = (countries: NamedCount[]) =>
  countries
    .filter((c) => c.code && CRAWLER_HEAVY_COUNTRIES.includes(c.code))
    .reduce((a, c) => a + c.value, 0);

export type TrafficWindow = {
  since: string;
  until: string;
  /** De-duplicated across the window by Vercel (not a sum of daily uniques). */
  visitors: number;
  views: number;
};
export type WeeklyTraffic =
  | { available: false; reason: string }
  | {
      available: true;
      week: TrafficWindow;
      previous: TrafficWindow;
      top_pages: NamedCount[];
      top_referrers: NamedCount[];
      top_countries: NamedCount[];
      crawler_heavy_visitors: number;
    };

/**
 * Traffic for an exact inclusive UTC date window and the equal-length window
 * before it — used by the weekly report. Same Vercel Web Analytics query API
 * (and therefore the same definitions) as the dashboard panel.
 */
export async function fetchWeeklyTraffic(since: string, until: string): Promise<WeeklyTraffic> {
  const token = process.env.VERCEL_ANALYTICS_TOKEN;
  if (!token) return { available: false, reason: "VERCEL_ANALYTICS_TOKEN is not set." };
  const projectId = process.env.VERCEL_ANALYTICS_PROJECT_ID || "prj_YEn45c67WshFBA6D6jP6NwkYBwk5";
  const teamId = process.env.VERCEL_ANALYTICS_TEAM_ID || "team_fwNsQpnIDnvi9VPRfxPf03QH";
  const base = "https://api.vercel.com/v1/query/web-analytics/visits";
  const DAY = 86_400_000;
  const days = Math.round((Date.parse(until) - Date.parse(since)) / DAY) + 1;
  const prevUntil = dayKey(new Date(Date.parse(since) - DAY));
  const prevSince = dayKey(new Date(Date.parse(since) - days * DAY));

  type Row = Record<string, string | number | null>;
  const get = async (endpoint: "count" | "aggregate", params: Record<string, string>) => {
    const qs = new URLSearchParams({ projectId, teamId, ...params });
    const res = await fetch(`${base}/${endpoint}?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Vercel Analytics HTTP ${res.status}`);
    return ((await res.json()) as { data: unknown }).data;
  };
  const window = async (s: string, u: string): Promise<TrafficWindow> => {
    const r = (await get("count", { since: s, until: u })) as Row;
    return { since: s, until: u, visitors: Number(r.visitors ?? 0), views: Number(r.pageviews ?? 0) };
  };
  const top = async (by: string, label: (v: string) => string = (v) => v) =>
    ((await get("aggregate", { by, since, until, limit: "9" })) as Row[])
      .filter((r) => r[by] && r[by] !== "Others")
      .slice(0, 8)
      .map((r) => ({ name: label(String(r[by])), value: Number(r.visitors ?? 0), code: String(r[by]) }));

  try {
    const [week, previous, top_pages, top_referrers, top_countries] = await Promise.all([
      window(since, until),
      window(prevSince, prevUntil),
      top("requestPath"),
      top("referrerHostname"),
      top("country", (c) => COUNTRY_NAMES[c] ?? c),
    ]);
    return {
      available: true, week, previous, top_pages, top_referrers, top_countries,
      crawler_heavy_visitors: crawlerHeavy(top_countries),
    };
  } catch (e) {
    return { available: false, reason: `Vercel Analytics query failed: ${(e as Error).message}.` };
  }
}

/** PostHog fallback — only used when the Vercel token isn't configured. */
async function fetchPostHogTraffic(): Promise<TrafficData> {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const host = process.env.POSTHOG_API_HOST || "https://eu.posthog.com";
  if (!key || !projectId) {
    return {
      available: false,
      reason:
        "Set VERCEL_ANALYTICS_TOKEN in Vercel (Account Settings → Tokens, scoped to the team) to pull Web Analytics visitors here.",
    };
  }
  try {
    const res = await fetch(`${host}/api/projects/${projectId}/query/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: {
          kind: "HogQLQuery",
          query:
            "select toDate(timestamp) as day, count(distinct person_id) as visitors " +
            "from events where event = '$pageview' and timestamp > now() - interval 30 day " +
            "group by day order by day",
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { available: false, reason: `PostHog query failed (HTTP ${res.status}).` };
    const json = (await res.json()) as { results?: [string, number][] };
    const daily = (json.results ?? []).map(([date, visitors]) => ({ date, visitors, views: null }));
    return {
      available: true,
      source: "posthog",
      window_days: 30,
      daily,
      // PostHog query is per-day uniques; the sum over-counts repeat visitors.
      visitors_total: daily.reduce((a, d) => a + d.visitors, 0),
      views_total: null,
      top_pages: [],
      top_referrers: [],
      top_countries: [],
      crawler_heavy_visitors: 0,
    };
  } catch {
    return { available: false, reason: "PostHog query timed out or errored." };
  }
}

export async function fetchTraffic(): Promise<TrafficData> {
  return (await fetchVercelTraffic()) ?? (await fetchPostHogTraffic());
}

export async function getControlCentreData() {
  const admin = getSupabaseAdmin();
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const DAY = 86_400_000;

  // ── Batch 1: base counts, sources, profiles, users, traffic ──
  const [
    totalEventsRes,
    activeCountRes,
    anticipatedRes,
    syntheticActiveRes,
    newWeekRes,
    newWeekOpenRes,
    recallsRes,
    drugsRes,
    watchlistRes,
    sourcesRes,
    profiles,
    authUsers,
    traffic,
  ] = await Promise.all([
    admin.from("shortage_events").select("id", { count: "exact", head: true }),
    admin
      .from("shortage_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .or(NOT_SYNTHETIC),
    admin
      .from("shortage_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "anticipated")
      .or(NOT_SYNTHETIC),
    admin
      .from("shortage_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .eq("synthetic", true),
    admin
      .from("shortage_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", iso(7 * DAY)),
    admin
      .from("shortage_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", iso(7 * DAY))
      .in("status", ["active", "anticipated"])
      .or(NOT_SYNTHETIC),
    admin.from("recalls").select("id", { count: "exact", head: true }),
    admin.from("drugs").select("id", { count: "exact", head: true }),
    admin.from("user_watchlists").select("id", { count: "exact", head: true }),
    admin
      .from("data_sources")
      .select("abbreviation, country_code, scrape_frequency_hours, last_scraped_at, is_active"),
    fetchAllProfiles(admin),
    fetchAllAuthUsers(admin),
    fetchTraffic(),
  ]);

  if (sourcesRes.error) throw new Error(sourcesRes.error.message);
  // A failed count must never render as 0 — fail the whole page loudly.
  for (const r of [totalEventsRes, activeCountRes, anticipatedRes, syntheticActiveRes, newWeekRes, newWeekOpenRes, recallsRes, drugsRes, watchlistRes]) {
    if (r.error) throw new Error(`count query failed: ${r.error.message}`);
  }

  // ── Batch 2 (bounded concurrency): ingest per day + active count per country ──
  // PostgREST aggregates are disabled on this project (PGRST123) and the
  // active set is ~55k rows — far past the 1,000-row response cap — so
  // per-country head-counts against the data_sources country list is the
  // cheapest correct option. Events FK onto data_sources, so that list is
  // authoritative — but include INACTIVE sources too: Japan alone has ~18k
  // active events from a source since flagged inactive.
  const days = 14;
  const countryCodes = [
    ...new Set(
      ((sourcesRes.data ?? []) as { country_code: string | null }[])
        .map((s) => (s.country_code ?? "").toUpperCase())
        .filter(Boolean),
    ),
  ];

  const ingestTasks = Array.from({ length: days }, (_, i) => {
    const from = new Date(now - (days - i) * DAY);
    const to = new Date(now - (days - 1 - i) * DAY);
    return async () => {
      const [created, verified, both] = await Promise.all([
        admin
          .from("shortage_events")
          .select("id", { count: "exact", head: true })
          .gte("created_at", from.toISOString())
          .lt("created_at", to.toISOString()),
        admin
          .from("shortage_events")
          .select("id", { count: "exact", head: true })
          .gte("last_verified_at", from.toISOString())
          .lt("last_verified_at", to.toISOString()),
        admin
          .from("shortage_events")
          .select("id", { count: "exact", head: true })
          .gte("created_at", from.toISOString())
          .lt("created_at", to.toISOString())
          .gte("last_verified_at", from.toISOString())
          .lt("last_verified_at", to.toISOString()),
      ]);
      const err = created.error ?? verified.error ?? both.error;
      if (err) throw new Error(`ingest count failed: ${err.message}`);
      // A row created and verified in the same window is ONE write: count it
      // under new_events only, so new_events + verified = distinct rows.
      return {
        date: dayKey(to),
        new_events: created.count ?? 0,
        verified: (verified.count ?? 0) - (both.count ?? 0),
      };
    };
  });

  const countryTasks = countryCodes.map((code) => async () => {
    const { count, error } = await admin
      .from("shortage_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .eq("country_code", code)
      .or(NOT_SYNTHETIC);
    if (error) throw new Error(`country count failed (${code}): ${error.message}`);
    return { code, count: count ?? 0 };
  });

  const [ingestCounts, countryCounts] = await Promise.all([
    batched(ingestTasks, 4),
    batched(countryTasks, 6),
  ]);

  const reporting = countryCounts.filter((c) => c.count > 0);
  const active_by_country = [...reporting]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((c) => ({ code: c.code, country: COUNTRY_NAMES[c.code] ?? c.code, count: c.count }));

  // ── Source freshness (active sources only) ──
  type SourceRow = {
    abbreviation: string;
    country_code: string;
    scrape_frequency_hours: number | null;
    last_scraped_at: string | null;
    is_active: boolean;
  };
  const sources = ((sourcesRes.data ?? []) as SourceRow[]).filter((s) => s.is_active);
  const freshnessDetail = sources.map((s) => {
    const hours = s.last_scraped_at
      ? (now - Date.parse(s.last_scraped_at)) / 3_600_000
      : null;
    const threshold = Math.max(s.scrape_frequency_hours ?? 24, 24) + STALE_GRACE_HOURS;
    const status: "ok" | "stale" | "never" =
      hours === null ? "never" : hours > threshold ? "stale" : "ok";
    return {
      abbreviation: s.abbreviation,
      country_code: s.country_code,
      hours_since: hours === null ? null : Number(hours.toFixed(1)),
      // How many expected cycles have been missed — a daily source 64 d dark
      // outranks a monthly one 200 d dark.
      overdue_ratio: hours === null ? null : hours / threshold,
      status,
    };
  });
  const freshness = {
    total: freshnessDetail.length,
    ok: freshnessDetail.filter((s) => s.status === "ok").length,
    stale: freshnessDetail.filter((s) => s.status === "stale").length,
    never: freshnessDetail.filter((s) => s.status === "never").length,
    buckets: {
      under_6h: freshnessDetail.filter((s) => s.hours_since !== null && s.hours_since < 6).length,
      h6_24: freshnessDetail.filter(
        (s) => s.hours_since !== null && s.hours_since >= 6 && s.hours_since < 24,
      ).length,
      d1_7: freshnessDetail.filter(
        (s) => s.hours_since !== null && s.hours_since >= 24 && s.hours_since < 168,
      ).length,
      over_7d_or_dark: freshnessDetail.filter(
        (s) => s.hours_since === null || s.hours_since >= 168,
      ).length,
    },
    worst: freshnessDetail
      .filter((s) => s.status !== "ok")
      .sort((a, b) => (b.overdue_ratio ?? -1) - (a.overdue_ratio ?? -1))
      .slice(0, 8),
  };

  // ── Users & growth ──
  // auth.users is the source of truth for accounts. If it could not be read
  // we cannot tell internal from external, so fail rather than guess.
  if (authUsers.length === 0) throw new Error("auth users could not be listed");
  const externalUsers = authUsers.filter((u) => !isInternalEmail(u.email));
  const internalUsers = authUsers.length - externalUsers.length;

  const roleOf = new Map(profiles.map((p) => [p.user_id, p.role]));
  const personaCounts = new Map<string, number>();
  for (const u of externalUsers) {
    const role = roleOf.has(u.id) ? roleOf.get(u.id) ?? "no role set" : "no profile yet";
    personaCounts.set(role, (personaCounts.get(role) ?? 0) + 1);
  }
  const personas = [...personaCounts.entries()]
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => b.count - a.count);

  const signupsByDay = new Map<string, number>();
  for (const u of externalUsers) {
    const key = u.created_at?.slice(0, 10);
    if (key) signupsByDay.set(key, (signupsByDay.get(key) ?? 0) + 1);
  }
  const signups_daily = Array.from({ length: 90 }, (_, i) => {
    const d = new Date(now - (89 - i) * DAY);
    const key = dayKey(d);
    return { date: key, count: signupsByDay.get(key) ?? 0 };
  });

  const weekAgoIso = iso(7 * DAY);
  const users_total = externalUsers.length;
  const signups_7d = externalUsers.filter((u) => u.created_at >= weekAgoIso).length;
  const wau = externalUsers.filter(
    (u) => u.last_sign_in_at && u.last_sign_in_at >= weekAgoIso,
  ).length;
  const never_signed_in = externalUsers.filter((u) => !u.last_sign_in_at).length;

  const latest_signups = [...externalUsers]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 6)
    .map((u) => ({
      masked_email: maskEmail(u.email),
      role: roleOf.get(u.id) ?? null,
      created_at: u.created_at,
    }));

  // ── Derived system + alert signals (honest: presence/reachability, not pings) ──
  const last24 = ingestCounts[ingestCounts.length - 1];
  // new_events and verified are disjoint (see ingestTasks), so this is distinct rows.
  const ingested24h = last24 ? last24.new_events + last24.verified : 0;
  const systems = [
    { name: "Supabase (Postgres + auth)", status: "ok" as const, note: "Queried live for this page" },
    {
      name: "Ingest pipeline (scrapers → DB)",
      status: ingested24h > 0 ? ("ok" as const) : ("down" as const),
      note:
        ingested24h > 0
          ? `${ingested24h.toLocaleString()} rows written in the last 24 h`
          : "No writes in the last 24 h",
    },
    {
      name: "Anthropic API (/chat)",
      status: process.env.ANTHROPIC_API_KEY ? ("ok" as const) : ("warn" as const),
      note: process.env.ANTHROPIC_API_KEY ? "Key configured" : "Key missing — chat degraded",
    },
    {
      name: "Resend (email)",
      status: process.env.RESEND_API_KEY ? ("ok" as const) : ("warn" as const),
      note: process.env.RESEND_API_KEY ? "Key configured" : "Key missing",
    },
    {
      name: "Web Analytics (traffic)",
      status: traffic.available ? ("ok" as const) : ("warn" as const),
      note: traffic.available
        ? `${traffic.source === "vercel" ? "Vercel" : "PostHog"} query API connected`
        : "Query token not set",
    },
  ];

  const alerts: { severity: "critical" | "serious" | "warning"; title: string; detail: string }[] = [];
  if (ingested24h === 0) {
    alerts.push({
      severity: "critical",
      title: "No pipeline writes in 24 h",
      detail: "No shortage_events rows created or re-verified in the last day — check cron hosts.",
    });
  }
  for (const s of freshness.worst.slice(0, 6)) {
    alerts.push({
      severity: s.status === "never" ? "warning" : "serious",
      title: `${s.abbreviation} (${s.country_code}) ${s.status === "never" ? "has never reported" : "is stale"}`,
      detail:
        s.status === "never"
          ? "last_scraped_at is null — source has never confirmed a scrape."
          : `Last scrape ${Math.round((s.hours_since ?? 0) / 24)} d ago.`,
    });
  }

  return {
    generated_at: new Date(now).toISOString(),
    kpis: {
      active_shortages: activeCountRes.count ?? 0,
      anticipated: anticipatedRes.count ?? 0,
      total_events: totalEventsRes.count ?? 0,
      synthetic_active_excluded: syntheticActiveRes.count ?? 0,
      events_added_7d: newWeekRes.count ?? 0,
      events_added_7d_open: newWeekOpenRes.count ?? 0,
      countries_live: reporting.length,
      users_total,
      users_internal: internalUsers,
      signups_7d,
      wau,
      never_signed_in,
      recalls_total: recallsRes.count ?? 0,
      drugs_total: drugsRes.count ?? 0,
      watchlist_items: watchlistRes.count ?? 0,
    },
    ingest: ingestCounts,
    active_by_country,
    freshness,
    personas,
    signups_daily,
    latest_signups,
    traffic,
    revenue: {
      available: false as const,
      reason: "Billing is not live. Wire Stripe here at launch.",
    },
    systems,
    alerts,
  };
}

export type ControlCentreData = Awaited<ReturnType<typeof getControlCentreData>>;
