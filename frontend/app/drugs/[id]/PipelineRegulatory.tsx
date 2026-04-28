"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, FlaskConical, ChevronRight, ExternalLink } from "lucide-react";

const COUNTRY_LABEL: Record<string, string> = {
  US: "🇺🇸 FDA", EU: "🇪🇺 EMA", GB: "🇬🇧 MHRA", AU: "🇦🇺 TGA",
};

const EVENT_LABEL: Record<string, string> = {
  fda_pdufa:    "FDA PDUFA action date",
  fda_adcomm:   "FDA Advisory Committee",
  fda_approval: "FDA approval",
  ema_chmp:     "EMA CHMP meeting",
  ema_approval: "EMA approval",
  mhra_decision:"MHRA decision",
  mhra_eams:    "MHRA Early Access scheme",
  tga_auspar:   "TGA AUSPAR",
  tga_approval: "TGA approval",
  other:        "Regulatory event",
};

interface RegEvent {
  id: string;
  event_type: string;
  event_date: string | null;
  sponsor: string | null;
  indication: string | null;
  description: string | null;
  outcome: string;
  source_url: string | null;
  source_country: string | null;
}

interface Trial {
  id: string;
  nct_id: string;
  intervention_name: string | null;
  brief_title: string | null;
  sponsor: string | null;
  phase: string | null;
  overall_status: string | null;
  primary_completion_date: string | null;
  conditions: string[] | null;
  countries: string[] | null;
  source_url: string | null;
}

interface Pipeline {
  upcoming_events: RegEvent[];
  historical_events: RegEvent[];
  ongoing_trials: Trial[];
  completed_trials: Trial[];
  counts: { upcoming_events: number; historical_events: number; ongoing_trials: number; completed_trials: number };
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function daysAway(iso: string) {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const days = Math.round((d - now) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 0) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

export default function PipelineRegulatory({ drugId }: { drugId: string }) {
  const [data, setData] = useState<Pipeline | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/pipeline/${drugId}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [drugId]);

  if (loading || !data) return null;

  const total =
    data.counts.upcoming_events + data.counts.ongoing_trials +
    data.counts.historical_events + data.counts.completed_trials;
  if (total === 0) return null;

  return (
    <section style={{ marginTop: 24, marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>
          Pipeline & regulatory calendar
        </span>
        <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
          {data.counts.upcoming_events} upcoming · {data.counts.ongoing_trials} active trials
        </span>
      </div>

      <div style={{
        background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12,
        padding: 20,
      }}>
        {/* Upcoming events row */}
        {data.upcoming_events.length > 0 && (
          <div style={{ marginBottom: data.ongoing_trials.length > 0 ? 20 : 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <CalendarDays size={12} /> Upcoming regulatory events
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {data.upcoming_events.slice(0, 4).map(e => (
                <a
                  key={e.id}
                  href={e.source_url ?? undefined}
                  target="_blank"
                  rel="noopener"
                  style={{
                    display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 14, alignItems: "center",
                    padding: "10px 12px", background: "var(--app-bg)", border: "1px solid var(--app-border)",
                    borderRadius: 8, textDecoration: "none", color: "inherit",
                  }}
                >
                  <div style={{ minWidth: 88 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--app-text)", fontFamily: "var(--font-dm-mono), monospace" }}>
                      {e.event_date ? formatDate(e.event_date) : "—"}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--app-text-4)", marginTop: 2 }}>
                      {e.event_date && daysAway(e.event_date)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      <span style={{ color: "var(--teal)" }}>{COUNTRY_LABEL[e.source_country ?? ""] ?? e.source_country}</span>
                      {" · "}
                      <span>{EVENT_LABEL[e.event_type] ?? e.event_type}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--app-text-3)", marginTop: 2, lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                      {e.description ?? e.sponsor ?? ""}
                    </div>
                  </div>
                  <ExternalLink size={12} color="var(--app-text-4)" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Phase III trials */}
        {data.ongoing_trials.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <FlaskConical size={12} /> Active Phase III/IV trials globally
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.ongoing_trials.slice(0, 5).map(t => (
                <a
                  key={t.id}
                  href={t.source_url ?? undefined}
                  target="_blank"
                  rel="noopener"
                  style={{
                    display: "grid", gridTemplateColumns: "70px 1fr auto", gap: 14, alignItems: "center",
                    padding: "10px 12px", background: "var(--app-bg)", border: "1px solid var(--app-border)",
                    borderRadius: 8, textDecoration: "none", color: "inherit",
                  }}
                >
                  <div style={{
                    fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
                    background: "var(--teal-bg)", color: "var(--teal)", textAlign: "center",
                  }}>
                    {t.phase?.replace("Phase ", "P") ?? "P3"}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.brief_title ?? t.intervention_name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--app-text-4)", marginTop: 2 }}>
                      {t.sponsor ?? "—"}
                      {t.primary_completion_date && (
                        <> · target completion {formatDate(t.primary_completion_date)}</>
                      )}
                      {t.countries && t.countries.length > 0 && (
                        <> · {t.countries.length} countr{t.countries.length === 1 ? "y" : "ies"}</>
                      )}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                    {t.nct_id}
                  </span>
                </a>
              ))}
              {data.counts.ongoing_trials > 5 && (
                <Link
                  href={`/intelligence/calendar?drug=${drugId}`}
                  style={{
                    fontSize: 12, color: "var(--teal)", textDecoration: "none",
                    paddingTop: 6, display: "inline-flex", alignItems: "center", gap: 4,
                  }}
                >
                  + {data.counts.ongoing_trials - 5} more trials <ChevronRight size={12} />
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Historical events (collapsed footer) */}
        {(data.counts.historical_events > 0 || data.counts.completed_trials > 0) && (
          <div style={{
            marginTop: 16, paddingTop: 12, borderTop: "1px dashed var(--app-border)",
            fontSize: 11, color: "var(--app-text-4)",
          }}>
            History: {data.counts.historical_events} past regulatory event{data.counts.historical_events === 1 ? "" : "s"}, {data.counts.completed_trials} completed trial{data.counts.completed_trials === 1 ? "" : "s"}.
          </div>
        )}
      </div>
    </section>
  );
}
