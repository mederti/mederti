"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CountryAlternatives as Data, ShortMedicine } from "@/lib/country-profile";

const ACCENT = "var(--teal, #127A63)";
const muted = "var(--app-text-3, #6a7280)";
const INITIAL = 10;

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const hasOfficial = (m: ShortMedicine) => m.approvals.length > 0 || m.alternatives.some((a) => a.authorisedHere);

type Filter = "official" | "cited" | "critical";

function Row({ m, name }: { m: ShortMedicine; name: string }) {
  return (
    <li style={{ padding: "12px 14px", borderTop: "1px solid var(--app-border, #e8ecf0)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <Link href={`/medicine/${m.slug}`} style={{ color: ACCENT, textDecoration: "none", fontWeight: 600, fontSize: 14.5 }}>
          {m.medicine}
        </Link>
        {m.critical && <span style={{ fontSize: 11.5, fontWeight: 700, color: "#b42318", textTransform: "uppercase", letterSpacing: ".04em" }}>Critical</span>}
        <span style={{ fontSize: 12.5, color: muted }}>
          {m.notices} active notice{m.notices === 1 ? "" : "s"}
        </span>
      </div>

      {m.approvals.length === 0 && m.alternatives.length === 0 ? (
        <div style={{ fontSize: 13, color: muted, marginTop: 4 }}>No official alternative on file for {name}.</div>
      ) : (
        <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, fontSize: 13.5, lineHeight: 1.6 }}>
          {m.approvals.map((a, i) => (
            <li key={`ap${i}`}>
              <span style={{ fontWeight: 600 }}>{a.schemeLabel}:</span>{" "}
              {a.sourceUrl ? (
                <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--app-text, #0c1118)" }}>{a.product}</a>
              ) : (
                a.product
              )}
              {a.expiresAt ? <span style={{ color: muted }}> · approval ends {fmt(a.expiresAt)}</span> : null}
            </li>
          ))}
          {m.alternatives.map((a, i) => (
            <li key={`al${i}`}>
              <span style={{ fontWeight: 600 }}>
                {a.authorisedHere
                  ? `Authorised substitute in ${name}:`
                  : a.sameMedicine
                    ? "Other product of the same medicine:"
                    : "Different medicine cited:"}
              </span>{" "}
              <Link href={`/medicine/${a.slug}`} style={{ color: "var(--app-text, #0c1118)" }}>{a.name}</Link>
              <span style={{ color: muted }}>
                {" "}· {a.publishers.join(", ") || "source"}
                {a.status === "single_source" && !a.authorisedHere ? " (single source, not independently confirmed)" : ""}
                {a.sourceUrl ? (
                  <>
                    {" "}·{" "}
                    <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>source</a>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Short medicines that have an official alternative in this country, plus the
 * critical list. Hidden entirely by the page when there is nothing to show.
 */
export default function CountryAlternatives({ name, data }: { name: string; data: Data }) {
  const official = useMemo(() => data.medicines.filter(hasOfficial), [data]);
  const cited = useMemo(() => data.medicines.filter((m) => !hasOfficial(m) && m.alternatives.length > 0), [data]);
  const critical = useMemo(() => data.medicines.filter((m) => m.critical), [data]);
  const criticalNone = critical.filter((m) => m.approvals.length === 0 && m.alternatives.length === 0).length;

  const filters = (
    [
      { key: "official" as const, label: "Official alternative here", list: official },
      { key: "cited" as const, label: "Other cited alternatives", list: cited },
      { key: "critical" as const, label: "All critical", list: critical },
    ] satisfies { key: Filter; label: string; list: ShortMedicine[] }[]
  ).filter((f) => f.list.length > 0);

  const [filter, setFilter] = useState<Filter>(filters[0]?.key ?? "critical");
  const [all, setAll] = useState(false);
  const list = filters.find((f) => f.key === filter)?.list ?? [];
  const shown = all ? list : list.slice(0, INITIAL);

  if (filters.length === 0) return null;

  const chip = (on: boolean): React.CSSProperties => ({
    padding: "6px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer",
    border: `1px solid ${on ? "#127A63" : "var(--app-border, #dde3e9)"}`,
    background: on ? "#E6FBF5" : "#fff", color: on ? "#0B5A49" : "var(--app-text-2, #3b434e)",
  });

  return (
    <section style={{ marginTop: 40 }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 4px" }}>
        {official.length > 0 ? `Short in ${name}, with an official alternative` : `Critical shortages in ${name}`}
      </h2>
      <p style={{ fontSize: 13, color: muted, margin: "0 0 12px", lineHeight: 1.6, maxWidth: 720 }}>
        {official.length > 0 && (
          <>
            {official.length} medicine{official.length === 1 ? "" : "s"} currently short in {name} {official.length === 1 ? "has" : "have"} a
            regulator-published alternative on file.{" "}
          </>
        )}
        {data.criticalMedicines !== null && data.criticalMedicines > 0 && (
          <>
            {data.criticalMedicines} medicine{data.criticalMedicines === 1 ? " has" : "s have"} a critical notice
            {data.evidenceAvailable ? <>; {criticalNone} of them have no official alternative on file</> : null}.{" "}
          </>
        )}
        {!data.evidenceAvailable && "Cited-alternative data is not available right now. "}
        Only sources that apply in {name} are shown. Not a substitution recommendation — confirm any switch with a
        pharmacist or prescriber.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {filters.map((f) => (
          <button key={f.key} style={chip(filter === f.key)} onClick={() => { setFilter(f.key); setAll(false); }}>
            {f.label} <span style={{ fontWeight: 500, opacity: 0.75 }}>{f.list.length}</span>
          </button>
        ))}
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0, border: "1px solid var(--app-border, #e8ecf0)", borderRadius: 12, background: "#fff", overflow: "hidden" }}>
        {shown.map((m, i) => (
          <div key={m.slug} style={i === 0 ? { marginTop: -1 } : undefined}>
            <Row m={m} name={name} />
          </div>
        ))}
      </ul>
      {list.length > INITIAL && (
        <button
          onClick={() => setAll((v) => !v)}
          style={{
            marginTop: 10, padding: "8px 16px", fontSize: 13.5, fontWeight: 600, borderRadius: 8, cursor: "pointer",
            border: "1px solid var(--app-border, #dde3e9)", background: "#fff", color: "var(--app-text, #0c1118)",
          }}
        >
          {all ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
    </section>
  );
}
