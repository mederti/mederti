import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Aggregation pass for the CEO control centre (/admin/control-centre).
 *
 * Everything here is real: Supabase counts, data_sources freshness, auth
 * users. Panels whose backing system isn't wired (PostHog traffic, Stripe
 * revenue) report { available: false } so the UI renders an honest
 * "not connected" state instead of fabricated numbers.
 *
 * Traffic becomes real when POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID
 * are set (HogQL query over pageview events).
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
    if (error) break;
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

export type TrafficData =
  | { available: false; reason: string }
  | { available: true; daily: { date: string; visitors: number }[]; total_30d: number };

/** Optional PostHog traffic — real numbers when the server-side key is set. */
async function fetchTraffic(): Promise<TrafficData> {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const host = process.env.POSTHOG_API_HOST || "https://eu.posthog.com";
  if (!key || !projectId) {
    return {
      available: false,
      reason:
        "Set POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID in Vercel to pull visitor counts here.",
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
    const daily = (json.results ?? []).map(([date, visitors]) => ({ date, visitors }));
    return {
      available: true,
      daily,
      total_30d: daily.reduce((a, d) => a + d.visitors, 0),
    };
  } catch {
    return { available: false, reason: "PostHog query timed out or errored." };
  }
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
    newWeekRes,
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
      .eq("status", "active"),
    admin
      .from("shortage_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "anticipated"),
    admin
      .from("shortage_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", iso(7 * DAY)),
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
      const [created, verified] = await Promise.all([
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
      ]);
      return {
        date: dayKey(to),
        new_events: created.count ?? 0,
        verified: verified.count ?? 0,
      };
    };
  });

  const countryTasks = countryCodes.map((code) => async () => {
    const { count } = await admin
      .from("shortage_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .eq("country_code", code);
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
      .sort((a, b) => (b.hours_since ?? Infinity) - (a.hours_since ?? Infinity))
      .slice(0, 8),
  };

  // ── Users & growth ──
  const roleOf = new Map(profiles.map((p) => [p.user_id, p.role]));
  const personaCounts = new Map<string, number>();
  for (const p of profiles) {
    const role = p.role ?? "no role set";
    personaCounts.set(role, (personaCounts.get(role) ?? 0) + 1);
  }
  const personas = [...personaCounts.entries()]
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => b.count - a.count);

  const signupsByDay = new Map<string, number>();
  for (const u of authUsers) {
    const key = u.created_at?.slice(0, 10);
    if (key) signupsByDay.set(key, (signupsByDay.get(key) ?? 0) + 1);
  }
  const signups_daily = Array.from({ length: 90 }, (_, i) => {
    const d = new Date(now - (89 - i) * DAY);
    const key = dayKey(d);
    return { date: key, count: signupsByDay.get(key) ?? 0 };
  });

  const weekAgoIso = iso(7 * DAY);
  const users_total = authUsers.length || profiles.length;
  const signups_7d = authUsers.filter((u) => u.created_at >= weekAgoIso).length;
  const wau = authUsers.filter(
    (u) => u.last_sign_in_at && u.last_sign_in_at >= weekAgoIso,
  ).length;

  const latest_signups = [...authUsers]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 6)
    .map((u) => ({
      masked_email: maskEmail(u.email),
      role: roleOf.get(u.id) ?? null,
      created_at: u.created_at,
    }));

  // ── Derived system + alert signals (honest: presence/reachability, not pings) ──
  const last24 = ingestCounts[ingestCounts.length - 1];
  const ingested24h = last24 ? last24.new_events + last24.verified : 0;
  const systems = [
    { name: "Supabase (Postgres + auth)", status: "ok" as const, note: "Queried live for this page" },
    {
      name: "Ingest pipeline (scrapers → DB)",
      status: ingested24h > 0 ? ("ok" as const) : ("down" as const),
      note:
        ingested24h > 0
          ? `${ingested24h.toLocaleString()} writes in the last 24 h`
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
      name: "PostHog (traffic)",
      status: traffic.available ? ("ok" as const) : ("warn" as const),
      note: traffic.available ? "Query API connected" : "Server query key not set",
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
  for (const s of freshness.worst.slice(0, 5)) {
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
      events_added_7d: newWeekRes.count ?? 0,
      countries_live: reporting.length,
      users_total,
      signups_7d,
      wau,
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
