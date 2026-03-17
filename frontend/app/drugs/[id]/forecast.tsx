"use client";

/* ── Types ── */

interface ShortageEvent {
  shortage_id?: string;
  id?: string;
  country_code?: string;
  country?: string;
  status?: string;
  severity?: string;
  reason?: string;
  reason_category?: string;
  start_date?: string;
  end_date?: string;
  estimated_resolution_date?: string;
  source_url?: string;
  last_verified_at?: string;
  updated_at?: string;
  created_at?: string;
  data_sources?: { name?: string; abbreviation?: string; country_code?: string };
}

interface Signal {
  type: "danger" | "warning" | "success";
  label?: string;
  text: string;
  source: string;
}

interface ForecastResult {
  p30: number;
  p90: number;
  p180: number;
  returnDate: Date;
  confidence: number;
  daysElapsed: number;
  avgDuration: number;
  nowPct: number;       // timeline: how far along we are (0–100)
  returnPct: number;    // timeline: where expected return sits (0–100)
  signals: Signal[];
}

/* ── Helpers ── */

function formatShortageDate(iso: string | null | undefined): string {
  if (!iso) return "TBC";
  return new Date(iso).toLocaleDateString("en-AU", { month: "short", year: "numeric" });
}

/* ── Forecast computation ── */

/**
 * Exponential-decay survival-curve model.
 *
 * P(shortage persists T more days | already active) = e^(−T / avgDuration)
 *
 * avgDuration is derived from resolved events in the dataset when available,
 * otherwise falls back to 270 days (industry median for manufacturing shortages).
 */
function computeForecast(
  shortages: ShortageEvent[],
  userCountry: string,
): ForecastResult | null {
  const activeEvents = shortages.filter((e) =>
    ["active", "current", "anticipated"].includes(
      (e.status ?? "").toLowerCase(),
    ),
  );

  if (activeEvents.length === 0) return null;

  /* ── Local market check — only show forecast if user's country is affected ── */
  const countryEvent = activeEvents.find(
    (e) => (e.country_code ?? "").toUpperCase() === userCountry.toUpperCase(),
  );
  if (!countryEvent) return null; // No local shortage → no forecast

  const shortageStart = new Date(
    countryEvent.start_date ??
      countryEvent.created_at ??
      Date.now(),
  );
  const daysElapsed = Math.max(
    0,
    Math.floor((Date.now() - shortageStart.getTime()) / 86400000),
  );

  /* ── Average duration from resolved events (fallback 270d) ── */
  const resolved = shortages.filter(
    (e) => (e.status ?? "").toLowerCase() === "resolved",
  );
  let avgDuration = 270; // industry median fallback
  if (resolved.length > 0) {
    const durations = resolved
      .map((e) => {
        const start = e.start_date ?? e.created_at;
        const end = e.end_date ?? e.estimated_resolution_date ?? e.updated_at;
        if (!start || !end) return null;
        const d = Math.floor(
          (new Date(end).getTime() - new Date(start).getTime()) / 86400000,
        );
        return d > 0 ? d : null;
      })
      .filter((d): d is number => d !== null);
    if (durations.length > 0) {
      avgDuration = Math.round(
        durations.reduce((a, b) => a + b, 0) / durations.length,
      );
    }
  }
  // Clamp to sensible range: 60 – 730 days
  avgDuration = Math.max(60, Math.min(730, avgDuration));

  /* ── Survival-curve probabilities ── */
  // P(shortage persists T more days) = e^(-T / avgDuration)
  // Clamped to [5%, 95%] to avoid false certainty
  const prob = (t: number) => {
    const raw = Math.exp(-t / avgDuration);
    return Math.round(Math.min(0.95, Math.max(0.05, raw)) * 100);
  };

  const p30 = prob(30);
  const p90 = prob(90);
  const p180 = prob(180);

  /* ── Expected return date ── */
  const returnDate = new Date(shortageStart);
  returnDate.setDate(returnDate.getDate() + avgDuration);

  /* ── Timeline percentages ── */
  // The bar spans from shortageStart to shortageStart + timelineSpan
  const timelineSpan = Math.max(avgDuration + 60, daysElapsed + 90); // always show some future
  const nowPct = Math.min(100, Math.max(0, (daysElapsed / timelineSpan) * 100));
  const returnPct = Math.min(100, Math.max(0, (avgDuration / timelineSpan) * 100));

  /* ── Confidence score ── */
  const historicalCount = resolved.length;
  const confidence = Math.min(85, 40 + historicalCount * 5);

  /* ── Signals ── */
  const signals: Signal[] = [];
  const avgMonths = Math.round(avgDuration / 30);
  if (historicalCount > 0) {
    signals.push({
      type: "danger",
      label: "Historical",
      text: `${historicalCount} prior shortage${historicalCount > 1 ? "s" : ""} averaged ~${avgMonths} months \u2014 currently at month ${Math.max(1, Math.floor(daysElapsed / 30))}`,
      source: "TGA / FDA",
    });
  }
  const anticipated = shortages.find(
    (e) => (e.status ?? "").toLowerCase() === "anticipated",
  );
  if (anticipated) {
    signals.push({
      type: "warning",
      label: "Anticipated",
      text: `Anticipated shortage notice issued for ${formatShortageDate(anticipated.start_date)}`,
      source: `${anticipated.country_code ?? ""} \u00b7 ${anticipated.data_sources?.abbreviation ?? anticipated.data_sources?.name ?? "Regulator"}`,
    });
  }
  if (activeEvents.length >= 3) {
    signals.push({
      type: "danger",
      label: "Multi-source",
      text: `Shortage active in ${activeEvents.length} countries simultaneously \u2014 indicates upstream supply issue`,
      source: "Multi-source",
    });
  }
  if (p180 < 40) {
    signals.push({
      type: "success",
      label: "Forecast",
      text: "Supply expected to stabilise within 6 months based on historical patterns",
      source: "Forecast model",
    });
  }

  return { p30, p90, p180, returnDate, confidence, daysElapsed, avgDuration, nowPct, returnPct, signals };
}

/* ── Component ── */

interface ForecastProps {
  shortages: ShortageEvent[];
  userCountry: string;
  drugName: string;
}

export function ShortageForcast({ shortages, userCountry, drugName }: ForecastProps) {
  const fc = computeForecast(shortages, userCountry);
  if (!fc) return null;

  const cards = [
    { label: "30 days", pct: fc.p30 },
    { label: "90 days", pct: fc.p90 },
    { label: "180 days", pct: fc.p180 },
  ];

  const themeFor = (pct: number) => {
    if (pct >= 65) return { bg: "var(--crit-bg)", border: "var(--crit-b)", text: "var(--crit)" };
    if (pct >= 35) return { bg: "var(--high-bg)", border: "var(--high-b)", text: "var(--high)" };
    return { bg: "var(--low-bg)", border: "var(--low-b)", text: "var(--low)" };
  };

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--app-border)",
        borderRadius: 12,
        padding: "16px 20px",
        marginBottom: 20,
      }}
    >
      {/* Label row with inline confidence */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color: "var(--app-text-4)",
          }}
        >
          Shortage forecast &middot; next 6 months
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: "var(--app-text-4)", fontWeight: 500 }}>
            Confidence
          </span>
          <div style={{
            width: 40, height: 3,
            background: "var(--app-bg-3, #e2e8f0)",
            borderRadius: 2,
            overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              width: `${fc.confidence}%`,
              background: "var(--teal)",
              borderRadius: 2,
            }} />
          </div>
          <span style={{
            fontSize: 11,
            fontFamily: "var(--font-dm-mono), monospace",
            color: "var(--teal)",
            fontWeight: 500,
          }}>
            {fc.confidence}
          </span>
        </div>
      </div>

      {/* 3 probability cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 8,
          marginBottom: 14,
        }}
      >
        {cards.map(({ label, pct }) => {
          const colors = themeFor(pct);
          return (
            <div
              key={label}
              style={{
                background: colors.bg,
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  color: colors.text,
                  marginBottom: 4,
                }}
              >
                {label}
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 600,
                  color: colors.text,
                  lineHeight: 1,
                }}
              >
                {pct}%
              </div>
              <div style={{ fontSize: 11, color: colors.text, marginTop: 3 }}>
                shortage risk
              </div>
            </div>
          );
        })}
      </div>

      {/* Signal tiles */}
      {fc.signals.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(fc.signals.length, 3)}, 1fr)`,
            gap: 8,
          }}
        >
          {fc.signals.slice(0, 3).map((s, i) => {
            const colors = {
              danger:  { bg: "var(--crit-bg)",  border: "var(--crit-b)",  text: "var(--crit)",  label: "Risk signal" },
              warning: { bg: "var(--high-bg)",  border: "var(--high-b)",  text: "var(--high)",  label: "Watch" },
              success: { bg: "var(--low-bg)",   border: "var(--low-b)",   text: "var(--low)",   label: "Positive signal" },
            }[s.type];

            return (
              <div key={i} style={{
                padding: "12px 14px",
                borderRadius: 10,
                background: "var(--app-bg-2, #f8fafc)",
                border: "1px solid var(--app-border, #e2e8f0)",
              }}>
                {/* Coloured icon dot */}
                <div style={{
                  width: 24, height: 24, borderRadius: 6,
                  background: colors.bg,
                  border: `1px solid ${colors.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  marginBottom: 8,
                }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: colors.text }} />
                </div>
                {/* Label */}
                <div style={{
                  fontSize: 9, fontWeight: 600, textTransform: "uppercase",
                  letterSpacing: "0.07em", color: colors.text, marginBottom: 4,
                }}>
                  {s.label ?? colors.label}
                </div>
                {/* Text */}
                <div style={{ fontSize: 12, color: "var(--app-text-2)", lineHeight: 1.5, marginBottom: 6 }}>
                  {s.text}
                </div>
                {/* Source */}
                <div style={{ fontSize: 10, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                  {s.source}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
