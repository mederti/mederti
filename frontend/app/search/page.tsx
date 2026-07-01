"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, type DrugHit, type StatusFacets } from "@/lib/api";
import V1Sidebar from "@/app/components/v1/V1Sidebar";
import MobileTabBar from "@/app/components/v1/MobileTabBar";
import { ContextChat } from "@/app/chat/components/ContextChat";
import "@/app/chat/chat.css";
import { truncateDrugName } from "@/lib/utils";
import { cleanBrandNames } from "@/lib/brand";
import { addRecentMedicine, addRecentSearch } from "@/lib/recent-activity";

function statusOf(d: DrugHit): { cls: string; label: string } {
  if (d.source === "catalogue") return { cls: "sp-ok", label: "Registered product" };
  const n = d.active_shortage_count ?? 0;
  if (n >= 5) return { cls: "sp-crit", label: `${n} active shortages` };
  if (n >= 1) return { cls: "sp-part", label: `${n} active shortage${n > 1 ? "s" : ""}` };
  return { cls: "sp-ok", label: "In supply" };
}

// ── Table-view display helpers ──────────────────────────────────────────
const SCHEME_SHORT: Record<string, string> = {
  tga_s19a: "S19A", mhra_ssp: "SSP", dhsc_msn: "MSN",
  fda_503b: "503B", fda_shortage: "FDA list", eu_art_5_2: "Art 5(2)",
};

function monthYear(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString("en-AU", { month: "short", year: "numeric" });
}
function timeAgo(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return null;
  const h = Math.floor(ms / 3.6e6);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  if (d < 60) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}
const isStale = (iso?: string | null): boolean =>
  !!iso && (Date.now() - new Date(iso).getTime()) / 86_400_000 >= 14;

const CUR_SYM: Record<string, string> = { AUD: "A$", USD: "US$", GBP: "£", EUR: "€", NZD: "NZ$", CAD: "C$" };
const fmtPrice = (amt: number, cur: string): string => `${CUR_SYM[cur] ?? cur + " "}${amt.toFixed(2)}`;

// Country-first supply verdict: answers "available in MY market or not", with
// the global picture demoted to a subline.
function marketStatus(
  d: DrugHit, market: string, isGlobal: boolean
): { cls: string; label: string; sub: string | null; warn: boolean } {
  if (d.source === "catalogue") {
    return { cls: "sp-ok", label: isGlobal ? "Registered product" : `Registered in ${market}`, sub: d.source_name || "Registered product", warn: false };
  }
  const active = d.active_shortage_count ?? 0;
  const other = d.other_markets_short ?? 0;
  if (active > 0) {
    const cls = (d.market_severity ?? 0) >= 2 ? "sp-crit" : "sp-part";
    if (isGlobal) return { cls, label: `${active} active shortage${active > 1 ? "s" : ""}`, sub: null, warn: true };
    return { cls, label: `Short in ${market}`, sub: other > 0 ? `+ ${other} other market${other > 1 ? "s" : ""} short` : null, warn: true };
  }
  if (isGlobal) return { cls: "sp-ok", label: "In supply", sub: null, warn: false };
  return {
    cls: "sp-ok",
    label: `Available in ${market}`,
    sub: other > 0 ? `short in ${other} other market${other > 1 ? "s" : ""}` : "no active shortages",
    warn: other > 0,
  };
}

// Markets that actually carry data (catalogue registration and/or shortage
// events). "ALL" maps to the legacy global scope. Not the mockup's aspirational
// "22 markets" — only what's backed.
const MARKETS: { code: string; name: string; flag: string }[] = [
  { code: "AU", name: "Australia", flag: "🇦🇺" },
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "CA", name: "Canada", flag: "🇨🇦" },
  { code: "JP", name: "Japan", flag: "🇯🇵" },
  { code: "CH", name: "Switzerland", flag: "🇨🇭" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "FR", name: "France", flag: "🇫🇷" },
  { code: "ES", name: "Spain", flag: "🇪🇸" },
  { code: "IT", name: "Italy", flag: "🇮🇹" },
  { code: "NL", name: "Netherlands", flag: "🇳🇱" },
  { code: "BE", name: "Belgium", flag: "🇧🇪" },
  { code: "FI", name: "Finland", flag: "🇫🇮" },
  { code: "NZ", name: "New Zealand", flag: "🇳🇿" },
  { code: "NO", name: "Norway", flag: "🇳🇴" },
  { code: "IE", name: "Ireland", flag: "🇮🇪" },
];
const marketOf = (code: string) =>
  MARKETS.find((m) => m.code === code) ?? { code, name: code, flag: "🏳️" };

const STATUS_OPTS: { key: string; label: string; facet: keyof StatusFacets }[] = [
  { key: "shortage", label: "Active shortage", facet: "shortage" },
  { key: "supply", label: "In supply", facet: "supply" },
  { key: "resolved", label: "Recently resolved", facet: "resolved" },
];

const SORT_OPTS: { key: string; label: string }[] = [
  { key: "relevance", label: "Relevance" },
  { key: "resolution", label: "Soonest to resolve" },
  { key: "severity", label: "Most severe first" },
];

// Form filter — labels for the form_bucket values (migration 053). Only buckets
// present in the result facet are shown, so this is just the display map + order.
const FORM_OPTS: { key: string; label: string }[] = [
  { key: "tablet", label: "Tablet" },
  { key: "capsule", label: "Capsule" },
  { key: "oral_liquid", label: "Oral liquid" },
  { key: "injectable", label: "Injectable" },
  { key: "topical", label: "Topical" },
  { key: "inhalation", label: "Inhalation" },
  { key: "drops", label: "Drops" },
  { key: "suppository", label: "Suppository" },
  { key: "patch", label: "Patch" },
  { key: "powder", label: "Powder" },
  { key: "other", label: "Other" },
];

// Gated controls — backing data not present in prod. Rendered disabled with an
// honest caption rather than silently no-opping.
const GATED: { label: string; caption: string }[] = [
  { label: "s19A alternative available", caption: "Needs TGA s19A feed — gated" },
  { label: "PBS-listed", caption: "Needs PBS feed — gated" },
  { label: "Brand substitution permitted", caption: "Needs substitution feed — gated" },
];

type Menu = null | "market" | "status" | "form" | "strength" | "sort" | "more";

function Results() {
  const params = useSearchParams();
  const router = useRouter();

  const urlQ = params.get("q") ?? "";
  const market = (params.get("market") || "AU").toUpperCase();
  const isGlobalMarket = market === "ALL";
  const statusStr = params.get("status") || "";
  const sort = params.get("sort") || "relevance";
  const statusSel = statusStr ? statusStr.split(",").filter(Boolean) : [];
  const formStr = params.get("form") || "";
  const formSel = formStr ? formStr.split(",").filter(Boolean) : [];
  const strengthStr = params.get("strength") || "";
  const strengthSel = strengthStr ? strengthStr.split(",").filter(Boolean) : [];

  const [q, setQ] = useState(urlQ);
  const [results, setResults] = useState<DrugHit[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<StatusFacets | null>(null);
  const [formFacet, setFormFacet] = useState<Record<string, number>>({});
  const [strengthFacet, setStrengthFacet] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [menu, setMenu] = useState<Menu>(null);
  // Google-style typo correction. `corrected` drives the "Showing results for X ·
  // Search instead for Y" banner. `triedRef` prevents re-correcting a term we
  // already auto-corrected away from (no loops); `forcedRef` holds terms the user
  // explicitly chose to keep ("search instead"), so we never re-correct those.
  const [corrected, setCorrected] = useState<{ from: string; to: string } | null>(null);
  const triedRef = useRef<Set<string>>(new Set());
  const forcedRef = useRef<Set<string>>(new Set());
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  // Merge a param patch into the current URL (null clears a key).
  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      router.replace(`/search?${next.toString()}`, { scroll: false });
    },
    [params, router]
  );

  // URL is the source of truth for filters → run search when q or any filter changes.
  useEffect(() => {
    const term = urlQ.trim();
    if (!term) { setResults([]); setTotal(0); setFacets(null); setFormFacet({}); setStrengthFacet({}); return; }
    let cancelled = false;
    setLoading(true);
    const sel = statusStr ? statusStr.split(",").filter(Boolean) : [];
    const formS = formStr ? formStr.split(",").filter(Boolean) : [];
    const strS = strengthStr ? strengthStr.split(",").filter(Boolean) : [];
    const lc = term.toLowerCase();
    api.search(term, 25, { market, status: sel, sort, form: formS, strength: strS })
      .then((data) => {
        if (cancelled) return;
        // Google-style auto-correct: term matched nothing but a close drug
        // exists → swap the query to it (the URL change re-runs this search)
        // and remember the original so we can offer "search instead".
        const sug = data.suggestion;
        if (
          data.results.length === 0 && sug &&
          sug.toLowerCase() !== lc &&
          !triedRef.current.has(lc) && !forcedRef.current.has(lc)
        ) {
          triedRef.current.add(lc);
          setCorrected({ from: term, to: sug });
          setResults([]); setTotal(0); setFacets(null);
          setParams({ q: sug });
          return;
        }
        // Showing a fresh, unrelated query → drop any stale correction banner.
        if (corrected && lc !== corrected.to.toLowerCase()) setCorrected(null);
        setResults(data.results);
        setTotal(data.total);
        setFacets(data.facets?.status ?? null);
        setFormFacet(data.facets?.form ?? {});
        setStrengthFacet(data.facets?.strength ?? {});
      })
      .catch(() => { if (!cancelled) { setResults([]); setTotal(0); setFacets(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // setParams/corrected intentionally omitted — URL params are the source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ, market, statusStr, sort, formStr, strengthStr]);

  // Keep the input mirror in sync when the URL query changes externally.
  useEffect(() => { setQ(urlQ); }, [urlQ]);

  // Log the search term to history once typing settles (avoids prefix spam).
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const t = setTimeout(() => addRecentSearch(term), 1200);
    return () => clearTimeout(t);
  }, [q]);

  // Click-outside closes any open dropdown.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  function onChange(v: string) {
    setQ(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setParams({ q: v.trim() || null });
    }, 200);
  }

  function toggleStatus(key: string) {
    const set = new Set(statusSel);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    setParams({ status: set.size ? [...set].join(",") : null });
  }

  function toggleParam(param: "form" | "strength", current: string[], key: string) {
    const set = new Set(current);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    setParams({ [param]: set.size ? [...set].join(",") : null });
  }

  // Form options present in the current result set (facet-driven). Strength
  // options sorted by numeric magnitude. Empty → the dropdown shows nothing
  // actionable, so we render it disabled rather than an empty menu.
  const formOptions = FORM_OPTS.filter((o) => (formFacet[o.key] ?? 0) > 0);
  const strengthOptions = Object.keys(strengthFacet).sort(
    (a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0)
  );

  // "Search instead for <original>": honour the raw term and don't re-correct it.
  function searchInsteadFor(original: string) {
    forcedRef.current.add(original.trim().toLowerCase());
    setCorrected(null);
    setParams({ q: original.trim() });
  }

  const showCorrection =
    corrected && urlQ.trim().toLowerCase() === corrected.to.toLowerCase() && results.length > 0;

  const mk = marketOf(market);
  // Only show the Trade price column once at least one result actually has a
  // price — keeps the column hidden (rather than a sea of "—") until the PBS
  // pricing feed is populated.
  // Show the price column whenever any result carries an official price in the
  // selected market — PBS for AU, NHS Drug Tariff / CMS NADAC for GB / US, etc.
  const hasTradePrice = results.some((d) => !!d.trade_price);

  return (
    <>
      <div className="searchbox v1sb">
        <span className="ic">⌕</span>
        <input
          autoFocus
          value={q}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search a drug — e.g. amoxicillin, cisplatin, metformin"
        />
      </div>

      {/* ── Compact filter bar ── */}
      <div className="fbar" ref={barRef}>
        {/* Market */}
        <div className="dd-wrap">
          <button
            className={`dd ${isGlobalMarket ? "" : "active"}`}
            onClick={() => setMenu(menu === "market" ? null : "market")}
          >
            <span className="fl">{isGlobalMarket ? "🌐" : mk.flag}</span>
            {isGlobalMarket ? "All markets" : mk.name}
            <span className="cv">▾</span>
          </button>
          {menu === "market" && (
            <div className="dd-menu">
              {MARKETS.map((m) => (
                <button
                  key={m.code}
                  className={`dd-opt ${market === m.code ? "sel" : ""}`}
                  onClick={() => { setParams({ market: m.code }); setMenu(null); }}
                >
                  <span className="fl">{m.flag}</span>{m.name}
                </button>
              ))}
              <div className="dd-div" />
              <button
                className={`dd-opt ${isGlobalMarket ? "sel" : ""}`}
                onClick={() => { setParams({ market: "ALL" }); setMenu(null); }}
              >
                <span className="fl">🌐</span>All markets
              </button>
            </div>
          )}
        </div>

        {/* Status (multi) */}
        <div className="dd-wrap">
          <button
            className={`dd ${statusSel.length ? "active" : ""}`}
            onClick={() => setMenu(menu === "status" ? null : "status")}
          >
            Status{statusSel.length > 0 && <span className="badge">{statusSel.length}</span>}
            <span className="cv">▾</span>
          </button>
          {menu === "status" && (
            <div className="dd-menu">
              {STATUS_OPTS.map((o) => (
                <button key={o.key} className="dd-opt check" onClick={() => toggleStatus(o.key)}>
                  <span className={`cb ${statusSel.includes(o.key) ? "on" : ""}`} />
                  {o.label}
                  {facets && <span className="fc">{facets[o.facet]}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Form (multi) — only actionable when the result set has parsed forms */}
        <div className="dd-wrap">
          <button
            className={`dd ${formSel.length ? "active" : ""}`}
            disabled={formOptions.length === 0}
            onClick={() => setMenu(menu === "form" ? null : "form")}
          >
            Form{formSel.length > 0 && <span className="badge">{formSel.length}</span>}
            <span className="cv">▾</span>
          </button>
          {menu === "form" && formOptions.length > 0 && (
            <div className="dd-menu">
              {formOptions.map((o) => (
                <button key={o.key} className="dd-opt check" onClick={() => toggleParam("form", formSel, o.key)}>
                  <span className={`cb ${formSel.includes(o.key) ? "on" : ""}`} />
                  {o.label}
                  <span className="fc">{formFacet[o.key]}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Strength (multi) — options populated from the queried term's products */}
        <div className="dd-wrap">
          <button
            className={`dd ${strengthSel.length ? "active" : ""}`}
            disabled={strengthOptions.length === 0}
            onClick={() => setMenu(menu === "strength" ? null : "strength")}
          >
            Strength{strengthSel.length > 0 && <span className="badge">{strengthSel.length}</span>}
            <span className="cv">▾</span>
          </button>
          {menu === "strength" && strengthOptions.length > 0 && (
            <div className="dd-menu">
              {strengthOptions.map((s) => (
                <button key={s} className="dd-opt check" onClick={() => toggleParam("strength", strengthSel, s)}>
                  <span className={`cb ${strengthSel.includes(s) ? "on" : ""}`} />
                  {s}
                  <span className="fc">{strengthFacet[s]}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* More filters (gated) */}
        <div className="dd-wrap">
          <button className="dd ghost" onClick={() => setMenu(menu === "more" ? null : "more")}>
            More filters<span className="cv">▾</span>
          </button>
          {menu === "more" && (
            <div className="dd-menu wide">
              <div className="dd-note">Supplements (ARTG Listed) are hidden by default. Type filter needs the entity-type backfill — coming next.</div>
              {GATED.map((g) => (
                <div key={g.label} className="dd-opt gated" aria-disabled>
                  <span className="cb" />
                  <span>{g.label}<span className="gcap">{g.caption}</span></span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sort (pinned right) */}
        <div className="dd-wrap sortw">
          <button
            className={`dd ${sort !== "relevance" ? "active" : ""}`}
            onClick={() => setMenu(menu === "sort" ? null : "sort")}
          >
            Sort: {SORT_OPTS.find((s) => s.key === sort)?.label ?? "Relevance"}
            <span className="cv">▾</span>
          </button>
          {menu === "sort" && (
            <div className="dd-menu right">
              {SORT_OPTS.map((o) => (
                <button
                  key={o.key}
                  className={`dd-opt ${sort === o.key ? "sel" : ""}`}
                  onClick={() => { setParams({ sort: o.key === "relevance" ? null : o.key }); setMenu(null); }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCorrection && corrected && (
        <div className="did-you-mean">
          Showing results for <b>{corrected.to}</b>
          <span className="dym-sep"> · </span>
          Search instead for{" "}
          <button className="link-btn" onClick={() => searchInsteadFor(corrected.from)}>
            &ldquo;{corrected.from}&rdquo;
          </button>
        </div>
      )}

      {q.trim() && (
        <div className="results-head"><div className="rh">{loading ? "Searching…" : <>Results for <b>{q.trim()}</b>{total > 0 ? ` · ${total}` : ""}{!isGlobalMarket && <> · {mk.name}</>}</>}</div></div>
      )}

      {/* ── Desktop: scannable table (everything a pharmacist needs per row) ── */}
      {results.length > 0 && (
        <div className="res-table-wrap">
          <table className="res-table">
            <thead>
              <tr>
                <th className="c-med">Medicine</th>
                <th className="c-mkt">{isGlobalMarket ? "Supply status" : <>In your market {mk.flag}</>}</th>
                <th className="c-sub">Can I substitute?</th>
                <th className="c-alt">Best alternative</th>
                <th className="c-n">Alts</th>
                {hasTradePrice && <th className="c-price">Trade price</th>}
                <th className="c-eb">Expected back</th>
                <th className="c-ver">Last verified</th>
              </tr>
            </thead>
            <tbody>
              {results.map((d) => {
                const ms = marketStatus(d, market, isGlobalMarket);
                const bn = cleanBrandNames(d.brand_names, d.generic_name);
                const eb = monthYear(d.estimated_resolution_date);
                const ver = timeAgo(d.last_verified_at);
                const isCat = d.source === "catalogue";
                // Catalogue rows link to /drugs/[id] too: the drug page has a
                // catalogue fallback that renders a registration page.
                const go = () => {
                  addRecentMedicine({ id: String(d.drug_id), name: d.generic_name });
                  router.push(`/drugs/${d.drug_id}`);
                };
                return (
                  <tr
                    key={d.drug_id}
                    className="clickable"
                    onClick={go}
                    role="link"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter") go(); }}
                  >
                    <td>
                      <div className="t-name">{truncateDrugName(d.generic_name)}</div>
                      {bn.length > 0 && <div className="t-brands">{bn.slice(0, 3).join(" · ")}</div>}
                      <div className="t-atc">{d.atc_code ? `ATC ${d.atc_code}` : "—"}</div>
                    </td>
                    <td>
                      <span className={`status-pill ${ms.cls}`}><span className="d" />{ms.label}</span>
                      {ms.sub && <div className={`t-mktsub ${ms.warn ? "warn" : ""}`}>{ms.sub}</div>}
                    </td>
                    <td>
                      {d.substitution ? (
                        <>
                          <span className="t-subyes">✓ Yes — {SCHEME_SHORT[d.substitution.scheme] ?? "pathway"}</span>
                          {d.substitution.reference && <div className="t-sub2">{d.substitution.reference}</div>}
                        </>
                      ) : isCat ? (
                        <span className="t-muted">—</span>
                      ) : (
                        <>
                          <div className="t-norm">Standard substitution</div>
                          <div className="t-sub2">no shortage approval needed</div>
                        </>
                      )}
                    </td>
                    <td>
                      {/* Always surface the closest alternative when we have one —
                          useful for proactive planning, not just during a shortage. */}
                      {d.best_alternative ? (
                        <>
                          <div className="t-alt">{d.best_alternative.name}</div>
                          {d.best_alternative.relationship && <div className="t-sub2">{d.best_alternative.relationship}</div>}
                        </>
                      ) : (
                        <span className="t-muted">—</span>
                      )}
                    </td>
                    <td className="center">
                      <span className={`t-count ${d.alternatives_count ? "" : "zero"}`}>{d.alternatives_count || "—"}</span>
                    </td>
                    {hasTradePrice && (
                      <td>
                        {d.trade_price ? (
                          <>
                            <div className="t-price">{fmtPrice(d.trade_price.ex_manufacturer, d.trade_price.currency)}</div>
                            <div className="t-sub2">
                              {d.trade_price.dispensed != null
                                ? `disp. ${fmtPrice(d.trade_price.dispensed, d.trade_price.currency)} · ${d.trade_price.source ?? "PBS"}`
                                : `${d.trade_price.label ?? "ex-mfr"} · ${d.trade_price.source ?? "PBS"}`}
                            </div>
                          </>
                        ) : (
                          <span className="t-muted">—</span>
                        )}
                      </td>
                    )}
                    <td>
                      {eb ? (
                        <><div className="t-eb">{eb}</div><div className="t-sub2">Sponsor est.</div></>
                      ) : (d.active_shortage_count ?? 0) > 0 ? (
                        <div className="t-eb none">No estimate</div>
                      ) : (
                        <span className="t-muted">—</span>
                      )}
                    </td>
                    <td>
                      {ver ? <span className={`t-ver ${isStale(d.last_verified_at) ? "stale" : ""}`}>{ver}</span> : <span className="t-muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Mobile: simple cards (table doesn't fit narrow screens) ── */}
      <div className="res-list">
        {results.map((d) => {
          const st = statusOf(d);
          const inner = (
            <div className="res-card">
              <div className="res-l">
                <div className="rn">{truncateDrugName(d.generic_name)}</div>
                {(() => { const bn = cleanBrandNames(d.brand_names, d.generic_name); return bn.length > 0 ? <div className="rg">{bn.slice(0, 3).join(" · ")}</div> : null; })()}
                <div className="rmeta">
                  {d.atc_code ? `ATC ${d.atc_code}` : "—"}
                  {d.alternatives_count ? ` · ${d.alternatives_count} alternative${d.alternatives_count > 1 ? "s" : ""}` : ""}
                </div>
              </div>
              <span className={`status-pill ${st.cls}`}><span className="d" />{st.label}</span>
            </div>
          );
          // Both drug and catalogue hits link to /drugs/[id]: the drug page has a
          // catalogue fallback (drugs/[id]/page.tsx) that renders a registration /
          // "in supply" page when the id resolves to a drug_catalogue row.
          return <Link
                key={d.drug_id}
                href={`/drugs/${d.drug_id}`}
                style={{ textDecoration: "none", color: "inherit" }}
                onClick={() => addRecentMedicine({ id: String(d.drug_id), name: d.generic_name })}
              >{inner}</Link>;
        })}
      </div>

      {!loading && q.trim() && results.length === 0 && (
        <div className="res-foot">
          No results for &ldquo;{q.trim()}&rdquo;{!isGlobalMarket && <> in {mk.name}</>}.
          {!isGlobalMarket ? (
            <> Try <button className="link-btn" onClick={() => setParams({ market: "ALL" })}>all markets</button> or the generic name.</>
          ) : (
            <> Try the generic or brand name.</>
          )}
        </div>
      )}
      {results.length > 0 && <div className="res-foot">Status from official regulators · tap a result for full detail</div>}
    </>
  );
}

// Middle-column grounded chat for the search page — ContextChat grounded to the
// current query/market so the user can interrogate the results they're looking
// at. Product names in answers are clickable through to the drug page.
function SearchChat() {
  const params = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const market = (params.get("market") || "AU").toUpperCase();
  const bodyText = q
    ? `The user is on the Mederti search results for "${q}" in the ${market} market. Answer about these medicines — substitutes, which markets are affected, and what's coming back into supply.`
    : `The user is on the Mederti search page (${market} market).`;
  const starters = q
    ? [
        `Summarise the shortage situation for ${q}`,
        "Which of these can I substitute?",
        "Which markets are most affected?",
      ]
    : [
        "Which drugs are most short right now?",
        `What's shortest in ${market}?`,
        "Show me critical antibiotic shortages",
      ];
  return (
    <ContextChat
      key={q || "search"}
      contextKey={q || "search"}
      title={q ? `Search: ${q}` : "Search"}
      category="Search"
      bodyText={bodyText}
      headerLabel="Ask about these results"
      placement="left"
      emptyLead="Ask me about these results — substitutes, which markets are affected, or what's coming back into supply."
      starters={starters}
    />
  );
}

export default function SearchPage() {
  return (
    <div className="v1home v1search">
      <style>{CSS}</style>
      <div className="shell">
        {/* ── Left sidebar (app nav) — shared with the drug page ── */}
        <V1Sidebar />

        {/* ── Middle column: grounded chat. New template — chat drives,
             reading left-to-right as nav → conversation → detail. ── */}
        <aside className="chat-col mederti-chat-root">
          <SearchChat />
        </aside>

        {/* ── Right column: results, the full-width detail panel ── */}
        <div className="shell-main">
          <div className="dg-main">
            <Suspense fallback={<div style={{ height: 80 }} />}>
              <Results />
            </Suspense>
          </div>
        </div>
      </div>
      <MobileTabBar />
    </div>
  );
}

const CSS = `
/* Tuned design system: scoped token block mirrors the global tuned palette
   (globals.css :root) and uses Geist. */
.v1home .res-l .rn{font-family:var(--font-geist-sans),'SF Pro Display',system-ui,sans-serif;font-weight:600;letter-spacing:-.02em}
.v1home{--ink:#0c1118;--green:#0fa676;--green-d:#0c8a62;--green-bg:#e8f6f0;--green-b:#dcebe6;
  --bg:#ffffff;--bg-2:#fafbfc;--bg-3:#eef2f5;--border:#e8ecf0;--border-2:#dde3e9;
  --text:#0c1118;--text-2:#3b434e;--text-3:#6a7280;--text-4:#98a1ac;
  --crit:#dc2647;--crit-bg:#fdeef1;--crit-b:#f8cdd6;--med:#b46708;--med-bg:#fdf6e9;--med-b:#f3dcae;--ok:#0fa676;--ok-bg:#e8f6f0;--ok-b:#bce4d4;
  --violet:#6366f1;--violet-b:#c7d2fe;--grad-brand:linear-gradient(135deg,#0c1118,#0c3a30 48%,#34d399);
  --hi-inset:inset 0 1px 0 rgba(255,255,255,.7);--sh-card:0 1px 1px rgba(12,17,24,.04),0 2px 6px -2px rgba(12,17,24,.06);
  background:var(--bg-2);color:var(--text);font-family:var(--font-geist-sans),system-ui,sans-serif;font-size:14px;letter-spacing:-.011em;-webkit-font-smoothing:antialiased;min-height:100vh}
.v1home *{box-sizing:border-box}
.v1home .brand{display:inline-flex;align-items:center;gap:9px;font-weight:800;font-size:18px;letter-spacing:-.03em;color:var(--ink);text-decoration:none}
.v1home .logo-img{height:31px;width:auto;display:block}

/* ── App shell (mirrors V1DrugView) ── */
.shell{display:flex;align-items:flex-start;min-height:100vh}
.sb{width:262px;flex-shrink:0;border-right:1px solid var(--border);background:var(--bg);position:sticky;top:0;height:100vh;display:flex;flex-direction:column}
.sb-top{height:64px;padding:0 28px;display:flex;align-items:center}
.sb-scroll{flex:1;overflow-y:auto;padding:8px 14px 8px 19px}
.sb-group{margin-top:14px}
.sb-glabel{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-4);padding:6px 9px}
.sb-item{display:flex;align-items:center;gap:10px;padding:9px;border-radius:10px;font-size:13px;font-weight:500;color:var(--text-2);text-decoration:none}
.sb-item:hover{background:var(--bg-2)}
.sb-item.sb-active{background:var(--green-bg);color:var(--green-d)}
.sb-empty{color:var(--text-4);font-style:italic}
.sb-sub{padding-left:18px;color:var(--text-3);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
.sb-sub:hover{color:var(--text);background:var(--bg-2)}
.sb-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.sb-dot.green{background:var(--ok)}
.sb-profile{border-top:1px solid var(--border);padding:16px;font-size:13px;font-weight:600;color:var(--text-2);text-decoration:none}
.sb-profile:hover{color:var(--green-d)}
.shell-main{flex:1;min-width:0}
.dg-main{flex:1;min-width:0;padding:32px 40px 80px;width:100%;background:#eef1f5}

/* ── Right-hand chat column (mirrors V1DrugView) ── */
.chat-col{width:380px;flex-shrink:0;display:flex;background:var(--bg);position:sticky;top:0;height:100vh}
.chat-panel{display:flex;flex-direction:column;height:100%}
.chat-head{display:flex;align-items:center;justify-content:space-between;padding:15px 16px;border-bottom:1px solid var(--border);background:linear-gradient(180deg,#fbfcfe,var(--bg))}
.chat-h-l{display:flex;align-items:center;gap:11px}
.chat-ic{width:30px;height:30px;border-radius:9px;background:var(--grad-brand);color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;box-shadow:0 5px 14px -5px rgba(15,166,118,.55)}
.chat-title{font-size:14px;font-weight:700;letter-spacing:-.01em}
.chat-sub{font-size:11px;color:var(--text-4);display:flex;align-items:center;gap:5px;margin-top:2px}
.chat-live-dot{width:6px;height:6px;border-radius:50%;background:var(--green);flex-shrink:0;animation:chat-pulse 2.2s infinite}
@keyframes chat-pulse{0%{box-shadow:0 0 0 0 rgba(15,166,118,.5)}70%{box-shadow:0 0 0 5px rgba(15,166,118,0)}100%{box-shadow:0 0 0 0 rgba(15,166,118,0)}}
.chat-free-tag{font-size:9.5px;font-weight:700;letter-spacing:.06em;color:var(--green-d);background:var(--green-bg);border:1px solid var(--green-b);padding:3px 8px;border-radius:99px;align-self:flex-start}
.chat-stream{padding:16px;flex:1;overflow-y:auto}
.chat-bubble{background:var(--bg-2);border:1px solid var(--border);border-radius:4px 13px 13px 13px;padding:11px 13px;font-size:12.5px;color:var(--text-2);line-height:1.5}
.chat-bubble>*:last-child{margin-bottom:0}
.chat-bubble strong{font-weight:700;color:var(--text)}
.chat-bubble .cb-p{margin:0 0 9px}
.chat-bubble .cb-list{margin:0 0 9px;padding-left:17px;display:flex;flex-direction:column;gap:3px}
.chat-bubble .cb-list li{line-height:1.45;padding-left:2px}
.chat-bubble .cb-quote{margin:0 0 9px;padding:9px 11px;background:var(--med-bg);border-left:3px solid var(--med-b);border-radius:0 9px 9px 0;color:var(--text-2)}
.chat-bubble .cb-table-wrap{margin:0 0 9px;overflow-x:auto;border:1px solid var(--border);border-radius:9px;background:var(--bg)}
.chat-bubble .cb-table{border-collapse:collapse;width:100%;font-size:11px}
.chat-bubble .cb-table th{text-align:left;font-weight:700;color:var(--text-3);background:var(--bg-3);padding:6px 9px;white-space:nowrap;border-bottom:1px solid var(--border)}
.chat-bubble .cb-table td{padding:6px 9px;border-bottom:1px solid var(--border);color:var(--text-2);vertical-align:top}
.chat-bubble .cb-table tr:last-child td{border-bottom:none}
.chat-suggest{display:flex;flex-direction:column;gap:7px;padding:0 16px 14px}
.chat-q{display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;font-size:12px;font-weight:500;color:var(--text-2);background:var(--bg);border:1px solid var(--border);border-radius:11px;padding:10px 13px;text-decoration:none;cursor:pointer;transition:transform .15s,box-shadow .15s,border-color .15s,background .15s,color .15s}
.chat-q-t{min-width:0}
.chat-q:hover{border-color:var(--violet-b);background:#f6f6ff;color:var(--violet);box-shadow:0 6px 16px -10px rgba(99,102,241,.6);transform:translateY(-1px)}
.chat-q-arrow{color:var(--text-4);font-size:13px;flex-shrink:0;opacity:0;transform:translateX(-5px);transition:.15s}
.chat-q:hover .chat-q-arrow{color:var(--violet);opacity:1;transform:translateX(0)}
.chat-input{display:flex;align-items:center;gap:8px;margin:0 16px 16px;padding:9px 9px 9px 14px;border:1px solid var(--border);border-radius:12px;background:var(--bg);text-decoration:none}
.chat-input input{flex:1;border:none;background:transparent;outline:none;font-size:13px;font-family:inherit;color:var(--text)}
.chat-input input::placeholder{color:var(--text-4)}
.chat-send{width:30px;height:30px;border-radius:8px;background:var(--ink);color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}
.chat-send:disabled{opacity:.5;cursor:default}
@media(max-width:1080px){.chat-col{display:none}}

/* ── Search box + results ── */
.searchbox.v1sb{display:flex;align-items:center;gap:8px;background:var(--bg);border:1.5px solid var(--border-2);border-radius:14px;padding:6px 8px 6px 18px;box-shadow:0 12px 36px -22px rgba(10,15,26,.28);transition:.15s}
.searchbox.v1sb:focus-within{border-color:var(--green);box-shadow:0 12px 36px -18px rgba(16,185,129,.4)}
.searchbox .ic{color:var(--text-4);font-size:17px}
.searchbox.v1sb input{flex:1;border:none;outline:none;font-size:15px;font-family:inherit;background:transparent;color:var(--text);padding:10px 0}
.searchbox.v1sb input::placeholder{color:var(--text-4)}
/* ── Compact filter bar ── */
.fbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:14px 2px 2px}
.fbar .dd-wrap{position:relative}
.fbar .sortw{margin-left:auto}
.fbar .dd{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 12px;border:1px solid var(--border-2);border-radius:10px;background:var(--bg);color:var(--text-2);font-family:inherit;font-size:12.5px;font-weight:600;letter-spacing:-.01em;cursor:pointer;transition:.14s;white-space:nowrap}
.fbar .dd:hover:not(:disabled){border-color:var(--text-4);color:var(--text)}
.fbar .dd:disabled{opacity:.45;cursor:not-allowed}
.fbar .dd.active{border-color:var(--green);background:var(--green-bg);color:var(--green-d)}
.fbar .dd.ghost{border-style:dashed;color:var(--text-3);font-weight:500}
.fbar .dd .cv{font-size:9px;color:var(--text-4);margin-left:1px}
.fbar .dd.active .cv{color:var(--green-d)}
.fbar .dd .fl{font-size:14px;line-height:1}
.fbar .dd .badge{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border-radius:99px;background:var(--green);color:#fff;font-size:10.5px;font-weight:700}
.fbar .dd-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:30;min-width:200px;max-height:340px;overflow-y:auto;background:var(--bg);border:1px solid var(--border-2);border-radius:12px;padding:6px;box-shadow:0 12px 32px -8px rgba(12,17,24,.22),var(--hi-inset)}
.fbar .dd-menu.wide{min-width:280px}
.fbar .dd-menu.right{left:auto;right:0}
.fbar .dd-opt{display:flex;align-items:center;gap:9px;width:100%;text-align:left;padding:8px 9px;border:none;border-radius:8px;background:transparent;color:var(--text-2);font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer}
.fbar .dd-opt:hover{background:var(--bg-2)}
.fbar .dd-opt.sel{background:var(--green-bg);color:var(--green-d);font-weight:600}
.fbar .dd-opt .fl{font-size:15px;line-height:1}
.fbar .dd-opt .fc{margin-left:auto;font-size:11px;color:var(--text-4);font-weight:600}
.fbar .dd-opt .cb{width:15px;height:15px;border-radius:4px;border:1.5px solid var(--border-2);flex-shrink:0;position:relative}
.fbar .dd-opt .cb.on{background:var(--green);border-color:var(--green)}
.fbar .dd-opt .cb.on::after{content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
.fbar .dd-opt.gated{cursor:not-allowed;opacity:.85}
.fbar .dd-opt.gated:hover{background:transparent}
.fbar .dd-opt .gcap{display:block;font-size:10.5px;color:var(--med);font-weight:600;margin-top:2px}
.fbar .dd-div{height:1px;background:var(--border);margin:5px 2px}
.fbar .dd-note{padding:7px 9px 9px;font-size:11px;color:var(--text-4);line-height:1.4}
.link-btn{background:none;border:none;padding:0;color:var(--green-d);font:inherit;font-weight:600;cursor:pointer;text-decoration:underline}
@media(max-width:820px){.fbar .sortw{margin-left:0;width:100%}.fbar .dd{height:40px}}
.did-you-mean{margin-top:14px;padding:10px 14px;background:var(--green-soft,rgba(15,166,118,.07));border:1px solid var(--border);border-radius:12px;font-size:13px;color:var(--text-3)}
.did-you-mean b{color:var(--text);font-weight:700}
.did-you-mean .dym-sep{color:var(--text-4)}
.results-head{padding:22px 2px 4px}
.results-head .rh{font-size:12px;color:var(--text-3)}
.results-head .rh b{color:var(--text);font-weight:700}
.res-list{padding:10px 0 0;display:flex;flex-direction:column;gap:9px}
.res-card{background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:15px 17px;display:flex;align-items:center;justify-content:space-between;gap:12px;box-shadow:var(--sh-card),var(--hi-inset);transition:transform .16s,box-shadow .16s,border-color .16s;cursor:pointer}
.res-card:hover{transform:translateY(-2px);border-color:var(--border-2);box-shadow:0 2px 4px rgba(12,17,24,.05),0 12px 28px -10px rgba(12,17,24,.16),var(--hi-inset)}
.res-l{min-width:0}
.res-l .rn{font-size:15px;font-weight:700;letter-spacing:-.02em}
.res-l .rg{font-size:12px;color:var(--text-3);font-family:var(--font-geist-mono),ui-monospace,monospace;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.res-l .rmeta{font-size:11px;color:var(--text-4);margin-top:6px}
.res-foot{padding:24px 0;text-align:center;font-size:12px;color:var(--text-4)}
.status-pill{font-size:11px;font-weight:600;padding:5px 11px;border-radius:99px;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;flex-shrink:0}
.status-pill .d{width:6px;height:6px;border-radius:50%;background:currentColor}
.sp-crit{color:var(--crit);background:var(--crit-bg);border:1px solid var(--crit-b)}
.sp-part{color:var(--med);background:var(--med-bg);border:1px solid var(--med-b)}
.sp-ok{color:var(--ok);background:var(--ok-bg);border:1px solid var(--ok-b)}

/* ── Desktop results table (v2 — country-first, everything-a-pharmacist-needs) ──
   No max-width cap: the results stretch to meet the right-hand chat column. */
.res-table-wrap{display:none;margin-top:10px;background:var(--bg);border:1px solid var(--border);border-radius:16px;overflow:hidden;box-shadow:var(--sh-card),var(--hi-inset)}
.res-table{width:100%;border-collapse:collapse;table-layout:fixed}
.res-table thead th{text-align:left;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-4);padding:13px 16px;background:var(--bg-2);border-bottom:1px solid var(--border);white-space:nowrap}
.res-table th.c-med{width:20%}.res-table th.c-mkt{width:15%}.res-table th.c-sub{width:13%}.res-table th.c-alt{width:14%}.res-table th.c-n{width:6%;text-align:center}.res-table th.c-price{width:11%}.res-table th.c-eb{width:11%}.res-table th.c-ver{width:10%}
.t-price{font-size:13px;font-weight:700;color:var(--ink);font-family:var(--font-geist-mono),ui-monospace,monospace}
.res-table tbody td{padding:14px 16px;border-bottom:1px solid var(--border);vertical-align:top}
.res-table tbody tr:last-child td{border-bottom:none}
.res-table tbody tr.clickable{cursor:pointer;transition:background .12s}
.res-table tbody tr.clickable:hover{background:var(--bg-2)}
.res-table tbody tr.clickable:focus-visible{outline:2px solid var(--green);outline-offset:-2px}
.res-table td.center{text-align:center;vertical-align:top}
.t-name{font-size:14px;font-weight:700;letter-spacing:-.02em;line-height:1.25;color:var(--ink);font-family:var(--font-geist-sans),system-ui,sans-serif}
.t-brands{font-size:11.5px;color:var(--text-3);font-family:var(--font-geist-mono),ui-monospace,monospace;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.t-atc{font-size:10.5px;color:var(--text-4);font-family:var(--font-geist-mono),ui-monospace,monospace;margin-top:5px}
.t-mktsub{font-size:10.5px;margin-top:5px;color:var(--text-4)}
.t-mktsub.warn{color:var(--med)}
.t-subyes{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;color:#6366f1;background:#eef0ff;border:1px solid #d7daff;padding:4px 9px;border-radius:8px}
.t-norm{font-size:12.5px;font-weight:600;color:var(--text-2)}
.t-alt{font-size:12.5px;font-weight:600;color:var(--ink);line-height:1.3}
.t-sub2{font-size:10.5px;color:var(--text-4);margin-top:3px}
.t-muted{font-size:12.5px;color:var(--text-4)}
.t-count{font-size:13px;font-weight:700;color:var(--text-2);font-family:var(--font-geist-mono),ui-monospace,monospace}
.t-count.zero{color:var(--text-4);font-weight:500}
.t-eb{font-size:12.5px;font-weight:700;color:var(--ink)}
.t-eb.none{font-weight:500;color:var(--text-4)}
.t-ver{font-size:11.5px;color:var(--text-3);font-family:var(--font-geist-mono),ui-monospace,monospace}
.t-ver.stale{color:var(--med)}
@media(min-width:1024px){.res-table-wrap{display:block}.res-list{display:none}}

@media(max-width:820px){.sb{display:none}.dg-main{margin:0 auto;padding:24px 20px 80px}}
`;
