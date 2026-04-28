"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, ExternalLink, ChevronLeft } from "lucide-react";

const COUNTRY_LABEL: Record<string, string> = {
  US: "🇺🇸 FDA", EU: "🇪🇺 EMA", GB: "🇬🇧 MHRA", AU: "🇦🇺 TGA",
};

const EVENT_LABEL: Record<string, string> = {
  fda_pdufa:    "FDA PDUFA",
  fda_adcomm:   "FDA AdComm",
  fda_approval: "FDA approval",
  ema_chmp:     "EMA CHMP",
  ema_approval: "EMA approval",
  mhra_decision:"MHRA decision",
  mhra_eams:    "MHRA EAMS",
  tga_auspar:   "TGA AUSPAR",
  tga_approval: "TGA approval",
  other:        "Other",
};

interface RegEvent {
  id: string;
  event_type: string;
  event_date: string;
  drug_id: string | null;
  generic_name: string | null;
  sponsor: string | null;
  indication: string | null;
  description: string | null;
  outcome: string;
  source_url: string | null;
  source_country: string | null;
}

interface CalendarData {
  total: number;
  horizon_days: number;
  by_month: Record<string, RegEvent[]>;
  events: RegEvent[];
}

const COUNTRIES = [
  { code: "", label: "All" },
  { code: "US", label: "🇺🇸 US" },
  { code: "EU", label: "🇪🇺 EU" },
  { code: "GB", label: "🇬🇧 GB" },
  { code: "AU", label: "🇦🇺 AU" },
];

export default function RegulatoryCalendarClient() {
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [country, setCountry] = useState("");
  const [days, setDays] = useState(90);

  function load() {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("days", String(days));
    if (country) params.set("country", country);
    fetch(`/api/regulatory-calendar?${params}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [country, days]);

  return (
    <div style={{ flex: 1, maxWidth: 1100, margin: "0 auto", padding: "32px 24px", width: "100%", boxSizing: "border-box" }}>
      <Link href="/intelligence" style={{ fontSize: 13, color: "var(--app-text-4)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 12 }}>
        <ChevronLeft size={13} /> Intelligence
      </Link>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <CalendarDays size={13} /> Regulatory Calendar
        </div>
        <h1 style={{ fontSize: "clamp(28px, 4vw, 38px)", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--app-text)", marginBottom: 12, fontFamily: "Georgia, serif" }}>
          What's coming next.
        </h1>
        <p style={{ fontSize: 15, color: "var(--app-text-3)", lineHeight: 1.6, maxWidth: 760 }}>
          Upcoming FDA Advisory Committee meetings, PDUFA dates, EMA CHMP opinions, MHRA decisions, and TGA registrations — drawn from official regulator calendars and matched to Mederti's catalogue of {`10,721`}+ drugs.
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, padding: 4, background: "white", border: "1px solid var(--app-border)", borderRadius: 8 }}>
          {COUNTRIES.map(c => (
            <button
              key={c.code}
              onClick={() => setCountry(c.code)}
              style={{
                padding: "6px 12px", fontSize: 13, fontWeight: 600,
                background: country === c.code ? "var(--app-text)" : "transparent",
                color: country === c.code ? "white" : "var(--app-text)",
                border: "none", borderRadius: 4, cursor: "pointer",
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, padding: 4, background: "white", border: "1px solid var(--app-border)", borderRadius: 8 }}>
          {[30, 60, 90, 180].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                padding: "6px 12px", fontSize: 13, fontWeight: 600,
                background: days === d ? "var(--app-text)" : "transparent",
                color: days === d ? "white" : "var(--app-text)",
                border: "none", borderRadius: 4, cursor: "pointer",
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: "48px 0", color: "var(--app-text-4)", fontSize: 13 }}>Loading calendar…</div>
      ) : !data || data.total === 0 ? (
        <div style={{ padding: "60px 24px", textAlign: "center", background: "white", border: "1px solid var(--app-border)", borderRadius: 12 }}>
          <CalendarDays size={32} color="var(--app-text-4)" style={{ margin: "0 auto 12px" }} />
          <div style={{ fontSize: 15, fontWeight: 600 }}>No scheduled events in this window</div>
          <div style={{ fontSize: 13, color: "var(--app-text-4)", marginTop: 6 }}>
            Try a longer horizon or a different country filter.
          </div>
        </div>
      ) : (
        <div style={{ background: "white", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
          {Object.entries(data.by_month).map(([month, events]) => (
            <div key={month}>
              <div style={{
                padding: "12px 18px", background: "var(--app-bg)",
                borderBottom: "1px solid var(--app-border)",
                fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                color: "var(--app-text-3)",
              }}>
                {new Date(month + "-01").toLocaleDateString("en-AU", { month: "long", year: "numeric" })}
                <span style={{ marginLeft: 8, color: "var(--app-text-4)", fontWeight: 500 }}>
                  · {events.length} event{events.length === 1 ? "" : "s"}
                </span>
              </div>
              {events.map((e: RegEvent) => (
                <div key={e.id} style={{
                  padding: "14px 18px", borderBottom: "1px solid var(--app-border)",
                  display: "grid", gridTemplateColumns: "80px 100px 1fr auto", gap: 16, alignItems: "center",
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--font-dm-mono), monospace" }}>
                    {new Date(e.event_date).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", color: "var(--teal)" }}>
                    {COUNTRY_LABEL[e.source_country ?? ""] ?? e.source_country} · {EVENT_LABEL[e.event_type] ?? e.event_type}
                  </div>
                  <div>
                    {e.drug_id ? (
                      <Link href={`/drugs/${e.drug_id}`} style={{ fontSize: 14, fontWeight: 600, color: "var(--app-text)", textDecoration: "none" }}>
                        {e.generic_name ?? "Unknown drug"}
                      </Link>
                    ) : (
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{e.generic_name ?? e.description?.slice(0, 60) ?? "Event"}</div>
                    )}
                    {e.sponsor && (
                      <div style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 2 }}>{e.sponsor}</div>
                    )}
                  </div>
                  {e.source_url && (
                    <a href={e.source_url} target="_blank" rel="noopener" style={{ color: "var(--app-text-4)" }}>
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
