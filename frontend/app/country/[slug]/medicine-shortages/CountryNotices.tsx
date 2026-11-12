"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import MedicineLink, { SignedInLinks } from "./MedicineLink";

export interface NoticeRow {
  id: string;
  medicine: string | null;
  medicineSlug: string | null;
  drugId: string | null;
  status: string;
  severity: string | null;
  reason: string | null;
  startDate: string | null;
  resolutionDate: string | null;
  sourceUrl: string | null;
  sourceLabel: string;
}

interface Props {
  code: string;
  name: string;
  latest: NoticeRow[];
  upcoming: NoticeRow[];
  resolving: NoticeRow[];
  /** Uncapped count behind `upcoming` — matches the stat card. */
  upcomingTotal: number | null;
  /** Rendered between the search box and the register tabs. */
  children?: React.ReactNode;
}

interface Page {
  rows: NoticeRow[];
  total: number | null;
  offset: number;
}

const sevColor: Record<string, string> = {
  critical: "#b42318",
  high: "#b54708",
  medium: "#b58a00",
  low: "#0fa676",
};
const SEVS = ["critical", "high", "medium", "low"] as const;
const ACCENT = "var(--teal, #127A63)";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type Tab = "latest" | "upcoming" | "resolving";

const th: React.CSSProperties = {
  padding: "10px 12px", fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.05em",
  color: "var(--app-text-3, #6a7280)", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap",
};
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 14, borderTop: "1px solid var(--app-border, #e8ecf0)", verticalAlign: "top" };
const muted = "var(--app-text-3, #6a7280)";

function NoticeTable({ rows, dateMode }: { rows: NoticeRow[]; dateMode: "start" | "resolution" }) {
  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--app-border, #e8ecf0)", borderRadius: 12, background: "#fff" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Medicine</th>
            <th style={th}>Status</th>
            <th style={th}>Severity</th>
            <th style={th}>{dateMode === "resolution" ? "Est. resolution" : "Starts / since"}</th>
            <th style={th}>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={td}>
                {r.medicineSlug ? (
                  <MedicineLink slug={r.medicineSlug} drugId={r.drugId} style={{ color: ACCENT, textDecoration: "none", fontWeight: 500 }}>
                    {r.medicine}
                  </MedicineLink>
                ) : (
                  <span style={{ color: "var(--app-text-2, #3b434e)" }}>{r.medicine ?? "Unlinked product"}</span>
                )}
                {r.reason ? <div style={{ fontSize: 12, color: muted, marginTop: 2 }}>{r.reason}</div> : null}
              </td>
              <td style={{ ...td, textTransform: "capitalize" }}>{r.status}</td>
              <td style={td}>
                {r.severity ? (
                  <span style={{ color: sevColor[r.severity] ?? "var(--app-text-2)", fontWeight: 600, textTransform: "capitalize" }}>{r.severity}</span>
                ) : "—"}
              </td>
              <td style={{ ...td, whiteSpace: "nowrap" }}>
                {dateMode === "resolution" ? fmt(r.resolutionDate) : fmt(r.startDate)}
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
  );
}

const moreBtn: React.CSSProperties = {
  padding: "8px 16px", fontSize: 13.5, fontWeight: 600, borderRadius: 8, cursor: "pointer",
  border: "1px solid var(--app-border, #dde3e9)", background: "#fff", color: "var(--app-text, #0c1118)",
};

/**
 * Notice explorer for the country page.
 *  - "Is your medicine short in <country>?" searches the country's whole open
 *    register (API-backed), not just the rows on the page.
 *  - Latest notices pages through the full register with "Show more" and
 *    filters by severity server-side; the two regulator-fact tabs (announced
 *    upcoming / estimated to resolve) filter the rows they were given.
 */
export default function CountryNotices({ code, name, latest, upcoming, resolving, upcomingTotal, children }: Props) {
  const api = useCallback(
    async (params: Record<string, string>): Promise<Page> => {
      const qs = new URLSearchParams(params).toString();
      const r = await fetch(`/api/country/${code}/notices?${qs}`);
      if (!r.ok) throw new Error(r.status === 429 ? "Too many requests — try again in a minute." : "Couldn't load notices. Try again.");
      return (await r.json()) as Page;
    },
    [code],
  );

  // ── Search across the whole register ──
  const [q, setQ] = useState("");
  const [search, setSearch] = useState<{ q: string; rows: NoticeRow[]; total: number | null } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const seq = useRef(0);
  const term = q.trim();

  useEffect(() => {
    if (term.length < 2) {
      setSearch(null);
      setSearching(false);
      setSearchErr(null);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    const t = setTimeout(() => {
      api({ q: term })
        .then((p) => {
          if (seq.current !== mine) return;
          setSearch({ q: term, rows: p.rows, total: p.total });
          setSearchErr(null);
        })
        .catch((e: Error) => { if (seq.current === mine) setSearchErr(e.message); })
        .finally(() => { if (seq.current === mine) setSearching(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [term, api]);

  const [moreBusy, setMoreBusy] = useState(false);
  const moreSearch = async () => {
    if (!search) return;
    setMoreBusy(true);
    try {
      const p = await api({ q: search.q, offset: String(search.rows.length) });
      setSearch((s) => (s && s.q === search.q ? { ...s, rows: [...s.rows, ...p.rows], total: p.total ?? s.total } : s));
    } catch (e) {
      setSearchErr((e as Error).message);
    } finally {
      setMoreBusy(false);
    }
  };

  // ── Register tabs ──
  const [tab, setTab] = useState<Tab>(latest.length ? "latest" : upcoming.length ? "upcoming" : "resolving");
  const [sev, setSev] = useState<string | null>(null);
  // Latest tab: starts with the server-rendered rows, then pages via the API.
  const [latestRows, setLatestRows] = useState<NoticeRow[]>(latest);
  const [latestTotal, setLatestTotal] = useState<number | null>(null);
  const [latestBusy, setLatestBusy] = useState(false);
  const [latestErr, setLatestErr] = useState<string | null>(null);

  const loadLatest = async (severity: string | null, offset: number) => {
    setLatestBusy(true);
    setLatestErr(null);
    try {
      const p = await api({ ...(severity ? { severity } : {}), offset: String(offset) });
      setLatestRows((cur) => (offset === 0 ? p.rows : [...cur, ...p.rows]));
      setLatestTotal(p.total);
    } catch (e) {
      setLatestErr((e as Error).message);
    } finally {
      setLatestBusy(false);
    }
  };

  const pickSeverity = (s: string | null) => {
    setSev(s);
    if (tab === "latest") void loadLatest(s, 0);
  };

  const fixed = tab === "upcoming" ? upcoming : resolving;
  const rows = useMemo(
    () => (tab === "latest" ? latestRows : fixed.filter((r) => !sev || r.severity === sev)),
    [tab, latestRows, fixed, sev],
  );
  const sevsPresent = useMemo(
    () => (tab === "latest" ? [...SEVS] : SEVS.filter((s) => fixed.some((r) => r.severity === s))),
    [tab, fixed],
  );

  const tabs: { key: Tab; label: string; n: number | null; hint: string }[] = [
    { key: "latest", label: "Latest notices", n: null, hint: `Every open shortage notice in ${name}, most recently started first.` },
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

  const chip = (on: boolean): React.CSSProperties => ({
    padding: "5px 11px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer", textTransform: "capitalize",
    border: `1px solid ${on ? "#127A63" : "var(--app-border, #dde3e9)"}`,
    background: on ? "#E6FBF5" : "#fff", color: on ? "#0B5A49" : "var(--app-text-2, #3b434e)",
  });

  const canShowMore = tab === "latest" && (latestTotal === null ? latestRows.length >= 50 && latestRows.length % 50 === 0 : latestRows.length < latestTotal);

  return (
    <SignedInLinks>
      {/* ── Is your medicine short here? ── */}
      <section style={{ marginTop: 18, padding: "18px 20px", border: "1px solid var(--app-border, #e8ecf0)", borderRadius: 14, background: "#fff" }}>
        <label htmlFor="country-med-search" style={{ display: "block", fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 10 }}>
          Is your medicine short in {name}?
        </label>
        <input
          id="country-med-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Medicine name, e.g. amoxicillin"
          autoComplete="off"
          style={{
            width: "100%", padding: "11px 14px", fontSize: 16, borderRadius: 10, outline: "none",
            border: "1px solid var(--app-border, #cfd6dd)", background: "#fff", color: "var(--app-text, #0c1118)",
          }}
        />
        <p style={{ fontSize: 12.5, color: muted, margin: "8px 0 0" }}>
          Searches every open notice in {name}&rsquo;s register by generic (active ingredient) name.
        </p>

        {term.length >= 2 && (
          <div style={{ marginTop: 14 }} aria-live="polite">
            {searchErr ? (
              <p style={{ fontSize: 14, color: "#b42318", margin: 0 }}>{searchErr}</p>
            ) : !search || search.q !== term ? (
              <p style={{ fontSize: 14, color: muted, margin: 0 }}>{searching ? "Searching…" : ""}</p>
            ) : search.rows.length === 0 ? (
              <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--app-text-2, #3b434e)" }}>
                <b style={{ color: "var(--app-text, #0c1118)" }}>
                  No open shortage notice matches &ldquo;{search.q}&rdquo; in {name}.
                </b>{" "}
                That means the regulator hasn&rsquo;t listed one under that name — it doesn&rsquo;t confirm stock at
                your pharmacy or wholesaler. Try the generic name, or{" "}
                <Link href={`/search?q=${encodeURIComponent(search.q)}`} style={{ color: ACCENT, fontWeight: 600 }}>
                  search all countries for &ldquo;{search.q}&rdquo;
                </Link>
                .
              </div>
            ) : (
              <>
                <p style={{ fontSize: 14, margin: "0 0 10px", color: "var(--app-text-2, #3b434e)" }}>
                  <b style={{ color: "var(--app-text, #0c1118)" }}>
                    {(search.total ?? search.rows.length).toLocaleString()} open notice{(search.total ?? search.rows.length) === 1 ? "" : "s"}
                  </b>{" "}
                  match &ldquo;{search.q}&rdquo; in {name}. Each strength and pack is listed separately.
                </p>
                <NoticeTable rows={search.rows} dateMode="start" />
                {search.total !== null && search.rows.length < search.total && (
                  <div style={{ marginTop: 10 }}>
                    <button style={moreBtn} onClick={moreSearch} disabled={moreBusy}>
                      {moreBusy ? "Loading…" : `Show more (${search.rows.length} of ${search.total.toLocaleString()})`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {children}

      {/* ── Register ── */}
      <section style={{ marginTop: 36 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 10px" }}>The {name} register</h2>
        <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--app-border, #e8ecf0)", overflowX: "auto" }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => {
                if (sev) {
                  setSev(null);
                  if (tab === "latest") { setLatestRows(latest); setLatestTotal(null); }
                }
                setTab(t.key);
              }}
              style={{
                padding: "10px 14px", fontSize: 14, fontWeight: 600, background: "none", border: "none",
                borderBottom: `2px solid ${tab === t.key ? "#127A63" : "transparent"}`, marginBottom: -1,
                color: tab === t.key ? "var(--app-text, #0c1118)" : muted,
                cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {t.label}
              {t.n !== null ? <span style={{ color: "var(--app-text-3, #98a1ac)", fontWeight: 500 }}> {t.n.toLocaleString()}</span> : null}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 13, color: muted, margin: "10px 0 12px", lineHeight: 1.55 }}>{active.hint}</p>

        {sevsPresent.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontSize: 12.5, color: muted }}>Severity</span>
            <button style={chip(sev === null)} onClick={() => pickSeverity(null)}>All</button>
            {sevsPresent.map((s) => (
              <button key={s} style={chip(sev === s)} onClick={() => pickSeverity(sev === s ? null : s)}>{s}</button>
            ))}
          </div>
        )}

        {latestErr && tab === "latest" ? (
          <p style={{ fontSize: 14, color: "#b42318" }}>{latestErr}</p>
        ) : null}

        {rows.length === 0 ? (
          <div style={{ padding: "28px 16px", textAlign: "center", fontSize: 14, color: muted, border: "1px dashed var(--app-border, #dde3e9)", borderRadius: 12 }}>
            {latestBusy && tab === "latest"
              ? "Loading…"
              : sev
                ? `No ${sev}-severity notices here.`
                : tab === "upcoming"
                  ? `${name}'s regulator has no announced upcoming shortages on record right now.`
                  : tab === "resolving"
                    ? `No active ${name} notices carry a regulator-estimated resolution date.`
                    : `No open notices linked to a medicine.`}
          </div>
        ) : (
          <NoticeTable rows={rows} dateMode={tab === "resolving" ? "resolution" : "start"} />
        )}

        {tab === "latest" && rows.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
            {canShowMore && (
              <button style={moreBtn} onClick={() => loadLatest(sev, latestRows.length)} disabled={latestBusy}>
                {latestBusy ? "Loading…" : "Show more"}
              </button>
            )}
            <span style={{ fontSize: 13, color: muted }}>
              {latestTotal !== null
                ? `Showing ${latestRows.length.toLocaleString()} of ${latestTotal.toLocaleString()} open notices${sev ? ` rated ${sev}` : ""} (active and anticipated).`
                : `Showing the ${latestRows.length} most recently started.`}
            </span>
          </div>
        )}
      </section>
    </SignedInLinks>
  );
}
