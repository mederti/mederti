"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export interface NoticeRow {
  id: string;
  medicine: string | null;
  medicineSlug: string | null;
  status: string;
  severity: string | null;
  reason: string | null;
  startDate: string | null;
  resolutionDate: string | null;
  sourceUrl: string | null;
  sourceLabel: string;
}

interface Props {
  name: string;
  latest: NoticeRow[];
  upcoming: NoticeRow[];
  resolving: NoticeRow[];
  activeTotal: number | null;
  /** Uncapped count behind `upcoming` — matches the stat card. */
  upcomingTotal: number | null;
}

const sevColor: Record<string, string> = {
  critical: "#b42318",
  high: "#b54708",
  medium: "#b58a00",
  low: "#0fa676",
};
const SEVS = ["critical", "high", "medium", "low"] as const;

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type Tab = "latest" | "upcoming" | "resolving";

/**
 * Interactive notice explorer for the country page: three regulator-fact views
 * (latest / announced upcoming / estimated to resolve), severity chips and a
 * medicine filter. Rows are server-fetched; filtering is client-side.
 */
export default function CountryNotices({ name, latest, upcoming, resolving, activeTotal, upcomingTotal }: Props) {
  const [tab, setTab] = useState<Tab>(latest.length ? "latest" : upcoming.length ? "upcoming" : "resolving");
  const [sev, setSev] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const source = tab === "latest" ? latest : tab === "upcoming" ? upcoming : resolving;
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return source.filter(
      (r) =>
        (!sev || r.severity === sev) &&
        (!needle || (r.medicine ?? "").toLowerCase().includes(needle)),
    );
  }, [source, sev, q]);

  const sevCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of source) if (r.severity) m[r.severity] = (m[r.severity] ?? 0) + 1;
    return m;
  }, [source]);

  const tabs: { key: Tab; label: string; n: number; hint: string }[] = [
    { key: "latest", label: "Latest notices", n: latest.length, hint: `Most recently started shortages in ${name}.` },
    {
      key: "upcoming",
      label: "Announced upcoming",
      n: upcomingTotal ?? upcoming.length,
      hint: `Shortages the regulator has announced ahead of time (start date still in the future). These are published notices — not a Mederti prediction.${
        upcomingTotal !== null && upcomingTotal > upcoming.length ? ` Showing the soonest ${upcoming.length} of ${upcomingTotal.toLocaleString()}.` : ""
      }`,
    },
    {
      key: "resolving",
      label: "Expected to resolve",
      n: resolving.length,
      hint: `Active shortages with a regulator-estimated resolution date, soonest first. Estimates often slip.`,
    },
  ];
  const active = tabs.find((t) => t.key === tab)!;

  const th: React.CSSProperties = {
    padding: "10px 12px", fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.05em",
    color: "var(--app-text-3, #6a7280)", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = { padding: "10px 12px", fontSize: 14, borderTop: "1px solid var(--app-border, #e8ecf0)", verticalAlign: "top" };
  const chip = (on: boolean): React.CSSProperties => ({
    padding: "5px 11px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
    border: `1px solid ${on ? "#127A63" : "var(--app-border, #dde3e9)"}`,
    background: on ? "#E6FBF5" : "#fff", color: on ? "#0B5A49" : "var(--app-text-2, #3b434e)",
  });

  return (
    <section style={{ marginTop: 32 }}>
      <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--app-border, #e8ecf0)", overflowX: "auto" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => { setTab(t.key); setSev(null); }}
            style={{
              padding: "10px 14px", fontSize: 14, fontWeight: 600, background: "none", border: "none",
              borderBottom: `2px solid ${tab === t.key ? "#127A63" : "transparent"}`, marginBottom: -1,
              color: tab === t.key ? "var(--app-text, #0c1118)" : "var(--app-text-3, #6a7280)",
              cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            {t.label} <span style={{ color: "var(--app-text-3, #98a1ac)", fontWeight: 500 }}>{t.n}</span>
          </button>
        ))}
      </div>
      <p style={{ fontSize: 13, color: "var(--app-text-3, #6a7280)", margin: "10px 0 12px", lineHeight: 1.55 }}>{active.hint}</p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by medicine"
          aria-label="Filter by medicine"
          style={{
            flex: "1 1 200px", minWidth: 0, maxWidth: 280, padding: "7px 11px", fontSize: 13.5,
            border: "1px solid var(--app-border, #dde3e9)", borderRadius: 8, outline: "none",
          }}
        />
        <button style={chip(sev === null)} onClick={() => setSev(null)}>All</button>
        {SEVS.filter((s) => sevCounts[s]).map((s) => (
          <button key={s} style={chip(sev === s)} onClick={() => setSev(sev === s ? null : s)}>
            <span style={{ textTransform: "capitalize" }}>{s}</span> {sevCounts[s]}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: "28px 16px", textAlign: "center", fontSize: 14, color: "var(--app-text-3, #6a7280)", border: "1px dashed var(--app-border, #dde3e9)", borderRadius: 12 }}>
          {source.length === 0
            ? tab === "upcoming"
              ? `${name}'s regulator has no announced upcoming shortages on record right now.`
              : tab === "resolving"
                ? `No active ${name} notices carry a regulator-estimated resolution date.`
                : `No recent notices linked to a medicine.`
            : "No notices match these filters."}
        </div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--app-border, #e8ecf0)", borderRadius: 12, background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Medicine</th>
                <th style={th}>Status</th>
                <th style={th}>Severity</th>
                <th style={th}>{tab === "resolving" ? "Est. resolution" : "Starts / since"}</th>
                <th style={th}>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>
                    {r.medicineSlug ? (
                      <Link href={`/medicine/${r.medicineSlug}`} style={{ color: "var(--teal, #127A63)", textDecoration: "none", fontWeight: 500 }}>
                        {r.medicine}
                      </Link>
                    ) : (
                      <span style={{ color: "var(--app-text-2, #3b434e)" }}>{r.medicine ?? "Unlinked product"}</span>
                    )}
                    {r.reason ? (
                      <div style={{ fontSize: 12, color: "var(--app-text-3, #6a7280)", marginTop: 2 }}>{r.reason}</div>
                    ) : null}
                  </td>
                  <td style={{ ...td, textTransform: "capitalize" }}>{r.status}</td>
                  <td style={td}>
                    {r.severity ? (
                      <span style={{ color: sevColor[r.severity] ?? "var(--app-text-2)", fontWeight: 600, textTransform: "capitalize" }}>{r.severity}</span>
                    ) : "—"}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {tab === "resolving" ? fmt(r.resolutionDate) : fmt(r.startDate)}
                  </td>
                  <td style={td}>
                    {r.sourceUrl ? (
                      <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--app-text-2, #3b434e)" }}>
                        {r.sourceLabel}
                      </a>
                    ) : (
                      r.sourceLabel
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === "latest" && latest.length > 0 && (
        <p style={{ fontSize: 13, color: "var(--app-text-3, #6a7280)", marginTop: 10 }}>
          Showing the {latest.length} most recent of {activeTotal?.toLocaleString() ?? "all"} active notices.
        </p>
      )}
    </section>
  );
}
