"use client";

import { useEffect, useState } from "react";

// ── Live data: briefing comes from /api/intelligence/briefing (refreshes
//    every 6h server-side). Articles come from /api/intelligence/latest,
//    fed by the daily /api/cron/generate-intelligence cron. Calendar and
//    market signals come from /api/regulatory-calendar and /api/market-data.
//
// Static fallbacks below kick in if any endpoint fails — the design review
// content, kept verbatim, so the page never goes blank.

interface BriefingItem {
  signal_strength: "high" | "medium" | "low";
  lead_phrase?: string;
  body: string;
}

interface BriefingPayload {
  market_pulse?: string;
  insights?: BriefingItem[];
  watch_list?: string[];
  generated_at?: string;
}

interface ArticleCard {
  slug: string;
  category: string;
  title: string;
  summary: string;
  date: string;
  read_time: string;
  tag: string;
  tag_tone: "high" | "regulatory" | "seasonal" | "neutral";
}

interface CalendarEvent {
  event_date: string;
  event_type: string;
  source_country: string | null;
  generic_name: string | null;
  description: string | null;
}

interface MarketSignal {
  label: string;
  value: string;
  delta: string;
  up: boolean;
  note: string;
}

/* ── Static fallbacks (kept identical to the prior design-review mock) ── */
const FALLBACK_BRIEFING: BriefingPayload = {
  market_pulse:
    "Geopolitical disruption (Strait of Hormuz) is compounding existing API concentration risk. Short-term shortage pressure elevated across injectable antibiotics and oncology agents.",
  insights: [
    {
      signal_strength: "high",
      body: "Strait of Hormuz disruption is adding 3–6 week delays to API shipments on India → EU/AU routes. Amoxicillin and Pip/Taz most exposed.",
    },
    {
      signal_strength: "high",
      body: "Cisplatin sole-source risk elevated: FDA issued warning letter to sole remaining US manufacturer. Stock depletion expected within 8–12 weeks.",
    },
    {
      signal_strength: "medium",
      body: "India monsoon season (Jul–Sep) will constrain Hyderabad API cluster output. Beta-lactam antibiotics at highest seasonal risk.",
    },
    {
      signal_strength: "low",
      body: "EMA CHMP reviewing 14 biosimilar applications in June. Insulin glargine biosimilar approval expected — may ease current critical shortage.",
    },
  ],
  watch_list: ["Cisplatin", "Piperacillin-Tazobactam", "Morphine (injectable)", "Amoxicillin"],
};

const FALLBACK_ARTICLES: ArticleCard[] = [
  {
    slug: "strait-of-hormuz-closure",
    category: "Supply Chain",
    title: "Strait of Hormuz Closure: Pharmaceutical Supply Chain Impact",
    summary:
      "Iran's temporary closure is disrupting API shipment routes from India to Europe and Australia, with delays of 3–6 weeks reported by logistics firms.",
    date: new Date(Date.now() - 1 * 86400000).toISOString(),
    read_time: "6 min read",
    tag: "High impact",
    tag_tone: "high",
  },
  {
    slug: "ema-chmp-june-agenda",
    category: "Regulatory",
    title: "EMA CHMP June Agenda: 14 Biosimilar Applications Under Review",
    summary:
      "The June CHMP meeting will consider biosimilar applications for insulin glargine and trastuzumab — both drugs with active critical shortages.",
    date: new Date(Date.now() - 3 * 86400000).toISOString(),
    read_time: "4 min read",
    tag: "Regulatory",
    tag_tone: "regulatory",
  },
  {
    slug: "india-monsoon-2026",
    category: "Manufacturing",
    title: "India Monsoon 2026: API Production Risk Outlook",
    summary:
      "Above-average monsoon forecast raises flood risk for Hyderabad and Visakhapatnam clusters supplying ~40% of global beta-lactam antibiotics.",
    date: new Date(Date.now() - 5 * 86400000).toISOString(),
    read_time: "5 min read",
    tag: "Seasonal risk",
    tag_tone: "seasonal",
  },
];

const FALLBACK_CALENDAR: CalendarEvent[] = [
  { event_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),  event_type: "CHMP meeting",      source_country: "EU",  generic_name: null, description: "biosimilar pipeline review" },
  { event_date: new Date(Date.now() + 16 * 86400000).toISOString().slice(0, 10), event_type: "PDUFA",             source_country: "US",  generic_name: "adalimumab biosimilar", description: "Sandoz" },
  { event_date: new Date(Date.now() + 22 * 86400000).toISOString().slice(0, 10), event_type: "Advisory Committee", source_country: "AU",  generic_name: null, description: "Advisory Committee on Medicines" },
  { event_date: new Date(Date.now() + 29 * 86400000).toISOString().slice(0, 10), event_type: "Expert Committee",   source_country: "WHO", generic_name: null, description: "WHO Expert Committee on Drug Dependence" },
];

const STRENGTH_DOT: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-400",
  low: "bg-slate-300",
};

const TAG_CLASS: Record<ArticleCard["tag_tone"], string> = {
  high:        "text-red-700 bg-red-50 border-red-200",
  regulatory:  "text-indigo-700 bg-indigo-50 border-indigo-200",
  seasonal:    "text-amber-700 bg-amber-50 border-amber-200",
  neutral:     "text-slate-600 bg-slate-50 border-slate-200",
};

const COUNTRY_TO_ORG: Record<string, string> = {
  US: "FDA", GB: "MHRA", DE: "BfArM", FR: "ANSM", IT: "AIFA", ES: "AEMPS",
  EU: "EMA", AU: "TGA", CA: "HC", JP: "PMDA", SG: "HSA", NZ: "Medsafe",
  NO: "NoMA", FI: "Fimea", IE: "HPRA", CH: "Swissmedic", BE: "FAMHP",
  NL: "CBG", PT: "Infarmed", GR: "EOF", MY: "NPRA", AE: "MOHAP",
};

function formatTimeAgo(iso: string | undefined): string {
  if (!iso) return "moments ago";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function formatArticleDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatCalendarDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function calendarSummary(e: CalendarEvent): string {
  const drug = e.generic_name ? `${e.generic_name}` : null;
  const desc = (e.description ?? "").trim();
  const head = e.event_type ?? "Event";
  if (drug && desc) return `${head} — ${drug} (${desc.slice(0, 40)})`;
  if (drug) return `${head} — ${drug}`;
  if (desc) return `${head} — ${desc.slice(0, 60)}`;
  return head;
}

function calendarOrg(e: CalendarEvent): string {
  return (e.source_country && COUNTRY_TO_ORG[e.source_country.toUpperCase()]) ?? e.source_country ?? "—";
}

interface MarketDataResp {
  currencies?: { label: string; rate: number; changePercent: number }[];
  freight?: { index: number; changePercent: number };
  updatedAt?: string;
}

function mapMarketSignals(m: MarketDataResp | null): MarketSignal[] {
  if (!m) {
    return [
      { label: "Baltic Dry Index", value: "1,847", delta: "+3.2%", up: true,  note: "Freight cost indicator" },
      { label: "INR / USD",        value: "83.42", delta: "−0.4%", up: false, note: "India API cost proxy" },
      { label: "CNY / USD",        value: "7.24",  delta: "+0.1%", up: true,  note: "China API cost proxy" },
    ];
  }
  const signals: MarketSignal[] = [];
  if (m.freight && typeof m.freight.index === "number") {
    const pct = m.freight.changePercent ?? 0;
    signals.push({
      label: "Baltic Dry Index",
      value: m.freight.index.toLocaleString("en-US"),
      delta: `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`,
      up: pct >= 0,
      note: "Freight cost indicator",
    });
  }
  const inr = m.currencies?.find((c) => c.label === "USD/INR");
  if (inr) {
    const pct = inr.changePercent ?? 0;
    signals.push({
      label: "USD / INR",
      value: inr.rate.toFixed(2),
      delta: `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`,
      up: pct >= 0,
      note: "India API cost proxy",
    });
  }
  const cny = m.currencies?.find((c) => c.label === "USD/CNY");
  if (cny) {
    const pct = cny.changePercent ?? 0;
    signals.push({
      label: "USD / CNY",
      value: cny.rate.toFixed(2),
      delta: `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`,
      up: pct >= 0,
      note: "China API cost proxy",
    });
  }
  return signals.length > 0 ? signals : mapMarketSignals(null);
}

export function IntelligenceView({
  onAsk,
  onOpenArticle,
}: {
  onAsk: (q: string) => void;
  onOpenArticle?: (article: ArticleCard) => void;
}) {
  const [briefing, setBriefing] = useState<BriefingPayload>(FALLBACK_BRIEFING);
  const [articles, setArticles] = useState<ArticleCard[]>(FALLBACK_ARTICLES);
  const [calendar, setCalendar] = useState<CalendarEvent[]>(FALLBACK_CALENDAR);
  const [signals, setSignals] = useState<MarketSignal[]>(mapMarketSignals(null));

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/api/intelligence/briefing").then((r) => r.json()).catch(() => null),
      fetch("/api/intelligence/latest?limit=3").then((r) => r.json()).catch(() => null),
      fetch("/api/regulatory-calendar?days=60").then((r) => r.json()).catch(() => null),
      fetch("/api/market-data").then((r) => r.json()).catch(() => null),
    ]).then(([brief, latest, cal, market]) => {
      if (cancelled) return;
      if (brief && !brief.error) setBriefing(brief);
      if (latest?.articles && Array.isArray(latest.articles) && latest.articles.length > 0) {
        setArticles(latest.articles);
      }
      if (cal?.events && Array.isArray(cal.events) && cal.events.length > 0) {
        setCalendar(cal.events.slice(0, 4));
      }
      if (market) setSignals(mapMarketSignals(market));
    });

    return () => { cancelled = true; };
  }, []);

  const watchDrugs = (briefing.watch_list ?? FALLBACK_BRIEFING.watch_list ?? []).slice(0, 6);
  const briefingItems = (briefing.insights ?? FALLBACK_BRIEFING.insights ?? []).slice(0, 4);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[900px] mx-auto px-8 pt-6 pb-12">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">Intelligence</h1>
            <p className="text-[13px] text-slate-500 mt-0.5">
              AI-synthesised signals from 124 intelligence sources
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Updated {formatTimeAgo(briefing.generated_at)}
          </div>
        </div>

        {/* Daily Briefing */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-8 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-widest text-teal-600 mb-1">
                Daily Briefing
              </div>
              <h2 className="text-[16px] font-semibold text-slate-900">The Pharma Brief</h2>
            </div>
            <button
              type="button"
              onClick={() =>
                onAsk("Give me today's pharmaceutical supply intelligence briefing")
              }
              className="text-[12px] text-teal-600 border border-teal-200 bg-teal-50 hover:bg-teal-100 px-3 py-1.5 rounded-lg transition-colors font-medium"
            >
              Ask AI for update ↗
            </button>
          </div>

          {/* Market pulse */}
          {briefing.market_pulse && (
            <div className="bg-teal-50 border border-teal-200 rounded-lg px-4 py-3 mb-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-teal-600 mb-1">
                Market Pulse
              </div>
              <p className="text-[13px] text-teal-900 leading-relaxed">
                {briefing.market_pulse}
              </p>
            </div>
          )}

          {/* Signal items */}
          <div className="flex flex-col gap-2.5 mb-4">
            {briefingItems.map((item, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${STRENGTH_DOT[item.signal_strength] ?? STRENGTH_DOT.low}`}
                />
                <p className="text-[13px] text-slate-700 leading-relaxed">
                  {item.lead_phrase ? <strong className="text-slate-900 font-semibold">{item.lead_phrase} </strong> : null}
                  {item.body}
                </p>
              </div>
            ))}
          </div>

          {/* Watch list */}
          {watchDrugs.length > 0 && (
            <div className="border-t border-slate-100 pt-3.5">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Watch Closely
              </div>
              <div className="flex flex-wrap gap-1.5">
                {watchDrugs.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() =>
                      onAsk(`Tell me about ${d} — supply outlook, shortages, substitutes`)
                    }
                    className="text-[12px] bg-slate-100 text-slate-700 hover:bg-teal-50 hover:text-teal-700 border border-transparent hover:border-teal-200 px-2.5 py-1 rounded-full transition-colors"
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Latest articles */}
        <div className="mb-8">
          <h2 className="text-[14px] font-semibold text-slate-900 mb-3">Latest Intelligence</h2>
          <div className="grid grid-cols-3 gap-4">
            {articles.map((a) => (
              <div
                key={a.slug}
                onClick={() => {
                  if (onOpenArticle) {
                    onOpenArticle(a);
                  } else {
                    // Fallback: open in a fresh chat via the ?q=...&send=1
                    // seed handler.
                    const params = new URLSearchParams({
                      q: `Tell me more about: ${a.title}`,
                      send: "1",
                    });
                    window.location.assign(`/chat?${params.toString()}`);
                  }
                }}
                className="bg-white border border-slate-200 rounded-xl p-4 hover:border-teal-200 hover:shadow-md cursor-pointer transition-all group shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {a.category}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${TAG_CLASS[a.tag_tone] ?? TAG_CLASS.neutral}`}
                  >
                    {a.tag}
                  </span>
                </div>
                <h3 className="text-[13px] font-semibold text-slate-900 mb-2 leading-snug group-hover:text-teal-700 transition-colors">
                  {a.title}
                </h3>
                <p className="text-[12px] text-slate-500 leading-relaxed mb-3">{a.summary}</p>
                <div className="text-[11px] text-slate-400">
                  {formatArticleDate(a.date)} · {a.read_time}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom row: calendar + market signals */}
        <div className="grid grid-cols-[1fr_260px] gap-4">

          {/* Regulatory Calendar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <h2 className="text-[14px] font-semibold text-slate-900 mb-3">Regulatory Calendar</h2>
            <div className="divide-y divide-slate-100">
              {calendar.map((c, i) => (
                <div
                  key={`${c.event_date}-${i}`}
                  className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="text-[11px] font-mono text-slate-400 w-12 shrink-0 pt-0.5">
                    {formatCalendarDate(c.event_date)}
                  </div>
                  <p className="flex-1 text-[12.5px] text-slate-700">{calendarSummary(c)}</p>
                  <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-medium shrink-0">
                    {calendarOrg(c)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Market Signals */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <h2 className="text-[14px] font-semibold text-slate-900 mb-3">Market Signals</h2>
            <div className="divide-y divide-slate-100">
              {signals.map((s) => (
                <div
                  key={s.label}
                  className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0"
                >
                  <div>
                    <div className="text-[12.5px] font-medium text-slate-700">{s.label}</div>
                    <div className="text-[10.5px] text-slate-400">{s.note}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[13px] font-mono font-semibold text-slate-900 tabular-nums">
                      {s.value}
                    </div>
                    <div
                      className={`text-[11px] font-medium ${s.up ? "text-red-500" : "text-teal-600"}`}
                    >
                      {s.delta}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
