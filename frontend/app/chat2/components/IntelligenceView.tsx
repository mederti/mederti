"use client";

// Static mock — briefing content and articles are hardcoded for design review.
// Wire briefing to /api/intelligence/briefing and articles to the
// intelligence_articles Supabase table when promoting from mock to production.

const BRIEFING_ITEMS = [
  {
    strength: "high",
    text: "Strait of Hormuz disruption is adding 3–6 week delays to API shipments on India → EU/AU routes. Amoxicillin and Pip/Taz most exposed.",
  },
  {
    strength: "high",
    text: "Cisplatin sole-source risk elevated: FDA issued warning letter to sole remaining US manufacturer. Stock depletion expected within 8–12 weeks.",
  },
  {
    strength: "medium",
    text: "India monsoon season (Jul–Sep) will constrain Hyderabad API cluster output. Beta-lactam antibiotics at highest seasonal risk.",
  },
  {
    strength: "low",
    text: "EMA CHMP reviewing 14 biosimilar applications in June. Insulin glargine biosimilar approval expected — may ease current critical shortage.",
  },
];

const WATCH_DRUGS = [
  "Cisplatin",
  "Piperacillin-Tazobactam",
  "Morphine (injectable)",
  "Amoxicillin",
];

const ARTICLES = [
  {
    category: "Supply Chain",
    title: "Strait of Hormuz Closure: Pharmaceutical Supply Chain Impact",
    summary:
      "Iran's temporary closure is disrupting API shipment routes from India to Europe and Australia, with delays of 3–6 weeks reported by logistics firms.",
    date: "May 26, 2026",
    readTime: "6 min read",
    tag: "High impact",
    tagColor: "text-red-700 bg-red-50 border-red-200",
  },
  {
    category: "Regulatory",
    title: "EMA CHMP June Agenda: 14 Biosimilar Applications Under Review",
    summary:
      "The June CHMP meeting will consider biosimilar applications for insulin glargine and trastuzumab — both drugs with active critical shortages.",
    date: "May 24, 2026",
    readTime: "4 min read",
    tag: "Regulatory",
    tagColor: "text-indigo-700 bg-indigo-50 border-indigo-200",
  },
  {
    category: "Manufacturing",
    title: "India Monsoon 2026: API Production Risk Outlook",
    summary:
      "Above-average monsoon forecast raises flood risk for Hyderabad and Visakhapatnam clusters supplying ~40% of global beta-lactam antibiotics.",
    date: "May 22, 2026",
    readTime: "5 min read",
    tag: "Seasonal risk",
    tagColor: "text-amber-700 bg-amber-50 border-amber-200",
  },
];

const CALENDAR = [
  { date: "Jun 3", event: "EMA CHMP meeting — biosimilar pipeline review", org: "EMA" },
  { date: "Jun 12", event: "FDA PDUFA: adalimumab biosimilar (Sandoz)", org: "FDA" },
  { date: "Jun 18", event: "TGA Advisory Committee on Medicines", org: "TGA" },
  { date: "Jun 25", event: "WHO Expert Committee on Drug Dependence", org: "WHO" },
];

const SIGNALS = [
  { label: "Baltic Dry Index", value: "1,847", delta: "+3.2%", up: true, note: "Freight cost indicator" },
  { label: "INR / USD", value: "83.42", delta: "−0.4%", up: false, note: "India API cost proxy" },
  { label: "CNY / USD", value: "7.24", delta: "+0.1%", up: true, note: "China API cost proxy" },
];

const STRENGTH_DOT: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-400",
  low: "bg-slate-300",
};

export function IntelligenceView({ onAsk }: { onAsk: (q: string) => void }) {
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
            Updated 4 hours ago
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
          <div className="bg-teal-50 border border-teal-200 rounded-lg px-4 py-3 mb-4">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-teal-600 mb-1">
              Market Pulse
            </div>
            <p className="text-[13px] text-teal-900 leading-relaxed">
              Geopolitical disruption (Strait of Hormuz) is compounding existing API concentration
              risk. Short-term shortage pressure elevated across injectable antibiotics and oncology
              agents.
            </p>
          </div>

          {/* Signal items */}
          <div className="flex flex-col gap-2.5 mb-4">
            {BRIEFING_ITEMS.map((item, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${STRENGTH_DOT[item.strength]}`}
                />
                <p className="text-[13px] text-slate-700 leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>

          {/* Watch list */}
          <div className="border-t border-slate-100 pt-3.5">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Watch Closely
            </div>
            <div className="flex flex-wrap gap-1.5">
              {WATCH_DRUGS.map((d) => (
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
        </div>

        {/* Latest articles */}
        <div className="mb-8">
          <h2 className="text-[14px] font-semibold text-slate-900 mb-3">Latest Intelligence</h2>
          <div className="grid grid-cols-3 gap-4">
            {ARTICLES.map((a) => (
              <div
                key={a.title}
                onClick={() => onAsk(`Tell me more about: ${a.title}`)}
                className="bg-white border border-slate-200 rounded-xl p-4 hover:border-teal-200 hover:shadow-md cursor-pointer transition-all group shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {a.category}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${a.tagColor}`}
                  >
                    {a.tag}
                  </span>
                </div>
                <h3 className="text-[13px] font-semibold text-slate-900 mb-2 leading-snug group-hover:text-teal-700 transition-colors">
                  {a.title}
                </h3>
                <p className="text-[12px] text-slate-500 leading-relaxed mb-3">{a.summary}</p>
                <div className="text-[11px] text-slate-400">
                  {a.date} · {a.readTime}
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
              {CALENDAR.map((c) => (
                <div
                  key={c.event}
                  className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="text-[11px] font-mono text-slate-400 w-12 shrink-0 pt-0.5">
                    {c.date}
                  </div>
                  <p className="flex-1 text-[12.5px] text-slate-700">{c.event}</p>
                  <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-medium shrink-0">
                    {c.org}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Market Signals */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <h2 className="text-[14px] font-semibold text-slate-900 mb-3">Market Signals</h2>
            <div className="divide-y divide-slate-100">
              {SIGNALS.map((s) => (
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
