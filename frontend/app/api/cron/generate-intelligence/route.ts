import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "@/lib/ai/usage-log";

// Run on the Node runtime — we hit Anthropic and Supabase admin in one shot
// and need a generous timeout because the generator can pull up to ~10s of
// db work and ~30s of Claude streaming.
export const runtime = "nodejs";
export const maxDuration = 300;

const client = new Anthropic();
const ROUTE = "/api/cron/generate-intelligence";
const MODEL = "claude-sonnet-4-20250514";

interface GeneratedArticle {
  slug: string;
  category: "Supply Chain" | "Regulatory" | "Manufacturing" | "Policy" | "Market";
  title: string;
  summary: string;
  body: string;
  tag: string;
  tagTone: "high" | "regulatory" | "seasonal" | "neutral";
  read_time: string;
  related_country_codes?: string[];
}

interface GeneratorPayload {
  articles: GeneratedArticle[];
}

const TAG_TO_DB_CATEGORY: Record<GeneratedArticle["category"], "article" | "report" | "data" | "media"> = {
  "Supply Chain": "article",
  "Regulatory": "article",
  "Manufacturing": "article",
  "Policy": "article",
  "Market": "data",
};

/**
 * Vercel Cron hits this once daily (06:00 UTC). Authorised via the
 * Authorization: Bearer <CRON_SECRET> header that Vercel automatically
 * attaches when CRON_SECRET is set in env. Manual invocation can also
 * pass ?secret=<CRON_SECRET>.
 */
export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}

async function handle(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    const url = new URL(req.url);
    const querySecret = url.searchParams.get("secret");
    const bearerOk = auth === `Bearer ${expected}`;
    const querySecretOk = querySecret === expected;
    if (!bearerOk && !querySecretOk) {
      return NextResponse.json({ error: "unauthorised" }, { status: 401 });
    }
  }

  const sb = getSupabaseAdmin();

  // ── Pull current data context (mirrors the briefing route) ──────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const sixtyDaysAhead = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

  const [
    activeRes,
    criticalRes,
    recentRes,
    crossCountryRes,
    upcomingEventsRes,
    facilityOaiRes,
  ] = await Promise.all([
    sb.from("shortage_events").select("id", { count: "exact", head: true }).eq("status", "active"),
    sb.from("shortage_events").select("id", { count: "exact", head: true }).eq("status", "active").eq("severity", "critical"),
    sb.from("shortage_events").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
    sb.from("shortage_events").select("drug_id, country_code, severity, reason_category").eq("status", "active"),
    sb.from("regulatory_events")
      .select("event_type, event_date, generic_name, sponsor, description, source_country")
      .eq("outcome", "scheduled")
      .gte("event_date", today)
      .lte("event_date", sixtyDaysAhead)
      .order("event_date", { ascending: true })
      .limit(15),
    sb.from("manufacturing_facilities")
      .select("facility_name, country, last_inspection_classification, last_inspection_date, oai_count_5y, warning_letter_count_5y")
      .or("last_inspection_classification.eq.OAI,warning_letter_count_5y.gt.0")
      .order("last_inspection_date", { ascending: false })
      .limit(8),
  ]);

  const drugCountries = new Map<string, Set<string>>();
  const reasonCounts = new Map<string, number>();
  for (const r of (crossCountryRes.data ?? []) as { drug_id: string; country_code: string; reason_category: string | null }[]) {
    if (!drugCountries.has(r.drug_id)) drugCountries.set(r.drug_id, new Set());
    drugCountries.get(r.drug_id)!.add(r.country_code);
    const k = r.reason_category ?? "unknown";
    reasonCounts.set(k, (reasonCounts.get(k) ?? 0) + 1);
  }
  const multiCountry = [...drugCountries.entries()].filter(([, c]) => c.size >= 3);
  const topReasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const topAffected = multiCountry
    .filter(([, c]) => c.size >= 5)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 5);
  const topDrugIds = topAffected.map(([id]) => id);
  const drugMap = new Map<string, string>();
  if (topDrugIds.length > 0) {
    const { data: drugs } = await sb.from("drugs").select("id, generic_name").in("id", topDrugIds);
    for (const d of drugs ?? []) {
      drugMap.set((d as { id: string }).id, (d as { generic_name: string }).generic_name);
    }
  }

  const dataContext = `
GLOBAL SHORTAGE STATE
- Active worldwide: ${activeRes.count ?? 0}
- Critical-severity: ${criticalRes.count ?? 0}
- New in last 7 days: ${recentRes.count ?? 0}
- Drugs short in 3+ countries simultaneously: ${multiCountry.length}

ROOT CAUSE BREAKDOWN
${topReasons.map(([r, c]) => `- ${r}: ${c}`).join("\n")}

TOP CONCENTRATION-RISK DRUGS (5+ countries)
${topAffected.map(([id, cs]) => `- ${drugMap.get(id) ?? "Unknown"}: ${cs.size} countries (${[...cs].join(", ")})`).join("\n") || "(none above threshold today)"}

UPCOMING REGULATORY EVENTS (next 60 days)
${(upcomingEventsRes.data ?? []).length === 0 ? "(none on file)" :
  (upcomingEventsRes.data ?? []).slice(0, 10).map((e) => {
    const r = e as { event_date: string; event_type: string; generic_name: string | null; sponsor: string | null; source_country: string | null; description: string | null };
    return `- ${r.event_date} | ${r.source_country} ${r.event_type} | ${r.generic_name ?? "?"} | ${r.sponsor ?? "?"} | ${(r.description ?? "").slice(0, 80)}`;
  }).join("\n")
}

MANUFACTURING QUALITY SIGNALS (FDA OAI / warning letters)
${(facilityOaiRes.data ?? []).length === 0 ? "(none on file)" :
  (facilityOaiRes.data ?? []).slice(0, 6).map((f) => {
    const r = f as { facility_name: string; country: string; last_inspection_classification: string; oai_count_5y: number; warning_letter_count_5y: number };
    return `- ${r.country} | ${r.facility_name} | ${r.last_inspection_classification} | ${r.oai_count_5y} OAI / ${r.warning_letter_count_5y} warning letters (5y)`;
  }).join("\n")
}
`;

  const systemPrompt = `You write the Mederti Intelligence "Latest" feed — short, sober, Economist-voiced articles for pharmacists, hospital procurement, regulators and pharma supply executives. Each piece is a self-contained 4-6 paragraph briefing on a single story drawn from today's data.

HOUSE STYLE — short and old beats long and clever:
- Anglo-Saxon words. Active voice. Name the actor.
- Cut adverbs ("very", "significantly", "increasingly").
- Avoid deplorables: address (v), facilitate, key (adj), major, leverage, robust, stakeholders, trajectory, transformative, proactive.
- No clichés: perfect storm, tipping point, wake-up call, deep dive, low-hanging fruit.
- Past tense for events; present for ongoing.
- Round large numbers. Show change as a percentage when it dramatises.

OUTPUT: valid JSON only. No commentary outside JSON. No code fences.`;

  const userPrompt = `Draft three articles for today's Mederti Intelligence feed. Each is a separate, specific story — not a digest. Pick the three most consequential stories drawn from the data below. Avoid overlap with each other.

${dataContext}

Output JSON exactly:

{
  "articles": [
    {
      "slug": "kebab-case-slug-unique-and-descriptive",
      "category": "Supply Chain" | "Regulatory" | "Manufacturing" | "Policy" | "Market",
      "title": "Headline — under 95 chars, ends without full stop, written like a news headline (not a summary)",
      "summary": "Two sentences. The first carries the news. The second names the consequence. Under 220 chars total.",
      "body": "Four to six short paragraphs separated by \\n\\n. Each paragraph is two to four sentences. First paragraph carries the news with the most-telling number. Middle paragraphs name actors, dates, places. Final paragraph names the implication — present tense, no exhortation.",
      "tag": "Short label like 'High impact' | 'Regulatory' | 'Seasonal risk' | 'Watch' | 'Resolved'",
      "tagTone": "high" | "regulatory" | "seasonal" | "neutral",
      "read_time": "N min read",
      "related_country_codes": ["XX", "YY"]
    }
  ]
}

Exactly three articles. Order most consequential first.`;

  const t0 = Date.now();
  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
  } catch (e) {
    return NextResponse.json({ error: "anthropic_failed", detail: String(e) }, { status: 502 });
  }

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let payload: GeneratorPayload;
  try {
    payload = JSON.parse(text) as GeneratorPayload;
  } catch {
    recordAiUsage({
      route: ROUTE,
      model: MODEL,
      response,
      latency_ms: Date.now() - t0,
      status: "error",
      notes: "invalid_json",
    });
    return NextResponse.json({ error: "AI returned invalid JSON", raw: text.slice(0, 400) }, { status: 500 });
  }

  if (!Array.isArray(payload.articles) || payload.articles.length === 0) {
    return NextResponse.json({ error: "no_articles_generated" }, { status: 500 });
  }

  // ── Insert published rows. Slugs must be unique; if Claude reuses one,
  //    suffix with today's date. ──────────────────────────────────────────
  const nowIso = new Date().toISOString();
  const datePrefix = nowIso.slice(0, 10);
  const inserted: { slug: string; title: string }[] = [];
  const skipped: { slug: string; reason: string }[] = [];

  for (const a of payload.articles) {
    const baseSlug = (a.slug || a.title || "untitled")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60);
    const slug = `${baseSlug}-${datePrefix}`;
    const dbCategory = TAG_TO_DB_CATEGORY[a.category] ?? "article";

    const row = {
      slug,
      title: a.title.slice(0, 280),
      description: a.summary.slice(0, 500),
      category: dbCategory,
      content_type: "NEWS" as const,
      body_json: {
        paragraphs: (a.body ?? "").split(/\n\n+/).filter(Boolean),
        tag: a.tag,
        tag_tone: a.tagTone,
        category_label: a.category,
        related_country_codes: a.related_country_codes ?? [],
      },
      author: "Mederti Intelligence",
      read_time: a.read_time ?? "4 min read",
      status: "published" as const,
      published_at: nowIso,
      source_data: { generator: "cron:daily", generated_at: nowIso },
    };

    const { error } = await sb.from("intelligence_articles").insert(row);
    if (error) {
      skipped.push({ slug, reason: error.message });
    } else {
      inserted.push({ slug, title: row.title });
    }
  }

  recordAiUsage({
    route: ROUTE,
    model: MODEL,
    response,
    latency_ms: Date.now() - t0,
    notes: `inserted=${inserted.length} skipped=${skipped.length}`,
  });

  return NextResponse.json({
    ok: true,
    generated_at: nowIso,
    inserted,
    skipped,
  });
}
