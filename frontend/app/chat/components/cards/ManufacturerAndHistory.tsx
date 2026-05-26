"use client";

import { useState } from "react";
import type { DrugDetailBundle, ManufacturerRow, ShortageHistoryStats } from "@/lib/chat/types";

const TOP_BY_COUNTRY = 5;
const TOP_ALL = 10;

// Compact strip of manufacturer chips. Default to country (AU) — much cleaner than
// the global view, which is full of US repackagers. Click "see all" to expand.
export function ManufacturersStrip({
  bundle,
  country = "AU",
}: {
  bundle: DrugDetailBundle;
  country?: string;
}) {
  const all = bundle.manufacturers ?? [];
  const inCountry = all.filter((m) => (m.country === country) || (m.countries_supplied || []).includes(country));
  const [expanded, setExpanded] = useState(false);

  if (all.length === 0) return null;

  const display = expanded
    ? all.slice(0, TOP_ALL)
    : (inCountry.length > 0 ? inCountry.slice(0, TOP_BY_COUNTRY) : all.slice(0, TOP_BY_COUNTRY));

  return (
    <div className="card-b-row card-mfg-row">
      <div className="section-label">
        {inCountry.length > 0 ? (
          <>
            Manufacturers · {country} · {inCountry.length} sponsor{inCountry.length === 1 ? "" : "s"}
            {all.length > inCountry.length ? <> · {all.length} globally</> : null}
          </>
        ) : (
          <>Manufacturers · {all.length} sponsor{all.length === 1 ? "" : "s"} globally</>
        )}
      </div>
      <div className="mfg-chips">
        {display.map((m) => (
          <MfgChip key={m.sponsor_id} m={m} />
        ))}
        {!expanded && (inCountry.length > TOP_BY_COUNTRY || all.length > TOP_BY_COUNTRY) ? (
          <button type="button" className="mfg-chip-more" onClick={() => setExpanded(true)}>
            +{(inCountry.length > 0 ? inCountry.length : all.length) - TOP_BY_COUNTRY} more
          </button>
        ) : null}
        {expanded && all.length > TOP_BY_COUNTRY ? (
          <button type="button" className="mfg-chip-more" onClick={() => setExpanded(false)}>
            show less
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MfgChip({ m }: { m: ManufacturerRow }) {
  // Clean up "PTY LTD" suffix etc. for display.
  const cleaned = m.name
    .replace(/\s+(PTY LTD|PTY LIMITED|LIMITED|LTD|LLC|INC\.?|GMBH|SRL|N\.?V\.?|S\.?A\.?)\s*$/i, "")
    .replace(/[,.]\s*$/, "")
    .trim();
  return (
    <span className="mfg-chip" title={`${m.name} · ${m.product_count} products`}>
      <span className="mfg-chip-name">{cleaned}</span>
      <span className="mfg-chip-count">{m.product_count}</span>
    </span>
  );
}

// One-line shortage history summary.
export function ShortageHistoryLine({ history }: { history: ShortageHistoryStats }) {
  if (!history || history.total_events === 0) return null;

  const parts: string[] = [];
  if (history.total_events > 1) {
    parts.push(`${history.total_events} signals across ${history.countries_seen.length} countr${history.countries_seen.length === 1 ? "y" : "ies"} since ${formatYear(history.first_seen)}`);
  } else {
    parts.push(`first short ${formatDateShort(history.first_seen)}`);
  }
  if (history.avg_resolved_duration_days != null) {
    parts.push(`avg resolved duration ${history.avg_resolved_duration_days} days`);
  }
  const topRecurrenceCountry = topCountryByRecurrence(history.recurrences_by_country);
  if (topRecurrenceCountry && history.recurrences_by_country[topRecurrenceCountry] >= 3) {
    parts.push(`${topRecurrenceCountry} has recurred ${history.recurrences_by_country[topRecurrenceCountry]}×`);
  }

  return (
    <div className="card-history-line">
      <span className="card-history-icon">↻</span>
      <span className="card-history-text">{parts.join(" · ")}</span>
    </div>
  );
}

function formatDateShort(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-AU", { month: "short", year: "numeric" });
  } catch {
    return d;
  }
}
function formatYear(d: string | null): string {
  if (!d) return "—";
  try {
    return String(new Date(d).getFullYear());
  } catch {
    return d;
  }
}
function topCountryByRecurrence(rec: Record<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [k, v] of Object.entries(rec)) {
    if (v > bestN) { best = k; bestN = v; }
  }
  return best;
}
