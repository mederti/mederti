import Link from "next/link";
import ClinicalDisclaimer from "@/app/components/ClinicalDisclaimer";
import V1CountryPicker from "@/app/components/v1/V1CountryPicker";
import V1Chat from "@/app/components/v1/V1Chat";
import V1DrugSearch from "@/app/components/v1/V1DrugSearch";
import { detectS19A, getS19AText } from "@/lib/shortage-utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

const FLAG: Record<string, string> = {
  AU: "🇦🇺", NZ: "🇳🇿", GB: "🇬🇧", UK: "🇬🇧", US: "🇺🇸", CA: "🇨🇦", SG: "🇸🇬",
  DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", ES: "🇪🇸", IE: "🇮🇪", CH: "🇨🇭", NO: "🇳🇴",
  SE: "🇸🇪", FI: "🇫🇮", DK: "🇩🇰", NL: "🇳🇱", JP: "🇯🇵", KR: "🇰🇷",
};
const flag = (c: string) => FLAG[(c || "").toUpperCase()] ?? "🌐";
const SEV: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };
const COUNTRY: Record<string, string> = {
  AU: "Australia", NZ: "New Zealand", GB: "United Kingdom", UK: "United Kingdom",
  US: "United States", CA: "Canada", DE: "Germany", FR: "France", IT: "Italy",
  ES: "Spain", IE: "Ireland", CH: "Switzerland", NO: "Norway", SE: "Sweden",
  FI: "Finland", DK: "Denmark", NL: "Netherlands", JP: "Japan", KR: "South Korea", SG: "Singapore",
};

function abbr(name?: string, a?: string | null) {
  if (a) return a;
  if (!name) return "";
  if (name.includes("Therapeutic Goods")) return "TGA";
  if (name.includes("Food and Drug")) return "FDA";
  if (name.includes("European Medicines")) return "EMA";
  if (name.includes("MHRA") || name.includes("Healthcare products")) return "MHRA";
  if (name.includes("Health Canada") || name.includes("Santé")) return "Health Canada";
  return name.length > 18 ? name.slice(0, 17) + "…" : name;
}
function timeAgo(iso?: string | null) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return "";
  const h = Math.floor(ms / 3.6e6);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}
function monthYear(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString("en-AU", { month: "short", year: "numeric" });
}

export default function V1DrugView({
  id, drug, shortages, statusLog, alternatives, userCountry, apiConcentration, recalls, approvalFootprint,
}: {
  id: string;
  drug: any;
  shortages: any[];
  statusLog: any[];
  alternatives: any[];
  userCountry: string;
  apiConcentration?: {
    count: number;
    band: "very_high" | "high" | "medium" | "low";
    makers: string[];
    countries: string[];
    whoPqCount?: number;
  } | null;
  recalls?: any[];
  approvalFootprint?: {
    total: number;
    generics: number;
    brands: number;
    latest: string | null;
  } | null;
}) {
  const CONC_LABEL: Record<string, string> = {
    very_high: "Very high", high: "High", medium: "Moderate", low: "Low",
  };
  const CONC_CLS: Record<string, string> = {
    very_high: "sp-crit", high: "sp-crit", medium: "sp-part", low: "sp-ok",
  };
  const active = shortages.filter((s) => ["active", "anticipated"].includes((s.status || "").toLowerCase()));
  // Country-FIRST status: a shortage far away but fine in your market is NOT a
  // shortage for you. The headline reflects YOUR country only; shortages
  // elsewhere are surfaced as secondary context + the regulator breakdown.
  const cName = COUNTRY[userCountry] ?? userCountry;
  const mine = active.find((s) => (s.country_code || "").toUpperCase() === userCountry) || null;
  const elsewhere = active.filter((s) => (s.country_code || "").toUpperCase() !== userCountry);
  const elsewhereCount = new Set(elsewhere.map((s) => (s.country_code || "").toUpperCase())).size;
  const localShortage = !!mine;
  const sev = (mine?.severity || "").toLowerCase();
  const isCrit = sev === "critical" || sev === "high";
  const anticipated = (mine?.status || "").toLowerCase() === "anticipated";

  // Expected back — sponsor-declared only, else "No estimate provided" (never computed).
  const expected = monthYear(mine?.estimated_resolution_date);
  const expSource = abbr(mine?.data_sources?.name, mine?.data_sources?.abbreviation) || "regulator";

  // Substitution — only assert "yes" when the regulator notice carries S19A language.
  const s19aEvt = active.find((s) => detectS19A(s.notes));
  const s19aText = s19aEvt ? getS19AText(s19aEvt.notes) : null;

  // Alternatives — real similarity only; null hides the %.
  const alts = (alternatives || []).slice(0, 5).map((a) => ({
    name: a.drugs?.generic_name ?? "Therapeutic alternative",
    rel: a.relationship_type ? String(a.relationship_type).replace(/_/g, " ") : "same class",
    pct: a.similarity_score != null ? Math.round(a.similarity_score * 100) : null,
    note: a.dose_conversion_notes ?? a.availability_note ?? null,
  }));
  const topAlt = alts[0] ?? null;

  // Regulator status by country
  const byCountry = new Map<string, any>();
  for (const s of shortages) {
    const cc = (s.country_code || "").toUpperCase();
    if (!cc) continue;
    const r = SEV[(s.severity || "").toLowerCase()] ?? 0;
    const ex = byCountry.get(cc);
    if (!ex || r > (SEV[(ex.severity || "").toLowerCase()] ?? -1)) byCountry.set(cc, s);
  }
  const regulators = [...byCountry.values()]
    .sort((a, b) => (SEV[(b.severity || "").toLowerCase()] ?? 0) - (SEV[(a.severity || "").toLowerCase()] ?? 0))
    .slice(0, 8);

  // Sources
  const srcMap = new Map<string, any>();
  for (const s of shortages) {
    const a = abbr(s.data_sources?.name, s.data_sources?.abbreviation);
    if (a && !srcMap.has(a)) srcMap.set(a, { a, cc: s.data_sources?.country_code ?? s.country_code ?? "", url: s.source_url, ver: s.last_verified_at ?? s.updated_at });
  }
  const sources = [...srcMap.values()].slice(0, 8);

  // History — computed from resolved shortages (real durations, labelled as pattern).
  const durations = shortages
    .filter((s) => (s.status || "").toLowerCase() === "resolved" && s.start_date && s.end_date)
    .map((s) => (new Date(s.end_date).getTime() - new Date(s.start_date).getTime()) / 2.628e9)
    .filter((m) => m > 0 && m < 60);
  const history = durations.length
    ? { n: durations.length, lo: Math.round(Math.min(...durations)), hi: Math.round(Math.max(...durations)) }
    : null;

  // Timeline
  const events = shortages
    .map((s) => ({ date: s.start_date ?? s.created_at, cc: s.country_code, txt: (s.status || "").toLowerCase() === "resolved" ? "Shortage resolved" : `${(s.severity || "shortage")} reported`, resolved: (s.status || "").toLowerCase() === "resolved" }))
    .filter((e) => e.date)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 6);

  const klass = drug.drug_class || drug.atc_description || null;

  // Why supply is disrupted — distribution of regulator-coded reasons across
  // this drug's shortage events. Real coded data; "unknown" folded into Other.
  const REASON_LABEL: Record<string, string> = {
    regulatory_action: "Regulatory action",
    supply_chain: "Supply chain",
    manufacturing_issue: "Manufacturing",
    discontinuation: "Discontinuation",
    demand_surge: "Demand surge",
    raw_material: "Raw material",
    distribution: "Distribution",
    unknown: "Other / unspecified",
  };
  const reasonTally = new Map<string, number>();
  for (const s of shortages) {
    const key = (s.reason_category || "unknown").toLowerCase();
    reasonTally.set(key, (reasonTally.get(key) || 0) + 1);
  }
  const reasonTotal = [...reasonTally.values()].reduce((a, b) => a + b, 0);
  const reasons = [...reasonTally.entries()]
    .map(([k, n]) => ({ label: REASON_LABEL[k] ?? k.replace(/_/g, " "), n, pct: Math.round((n / reasonTotal) * 100), other: k === "unknown" }))
    // Real coded reasons first; "Other / unspecified" always sinks to the end.
    .sort((a, b) => (a.other === b.other ? b.n - a.n : a.other ? 1 : -1))
    .slice(0, 5);
  const showReasons = reasonTotal >= 2 && reasons.some((r) => r.label !== "Other / unspecified");

  // Recalls — most recent first; active Class I are the highest-signal.
  const recallList = (recalls || [])
    .slice()
    .sort((a, b) => new Date(b.announced_date || 0).getTime() - new Date(a.announced_date || 0).getTime())
    .slice(0, 6);

  return (
    <div className="v1home v1drug">
      <style>{CSS}</style>
      <div className="shell">
        {/* ── Left sidebar (app nav) ── */}
        <aside className="sb">
          <div className="sb-top">
            <Link href="/" className="brand" aria-label="Mederti home">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-black.png" alt="mederti" className="logo-img" />
            </Link>
          </div>
          <div style={{ padding: "14px 14px 8px" }}><V1CountryPicker /></div>
          <div className="sb-scroll">
            <div className="sb-group">
              <div className="sb-glabel">My medicines</div>
              <Link href="/login" className="sb-item sb-empty">Sign in to save medicines</Link>
            </div>
            <div className="sb-group">
              <div className="sb-glabel">Browse</div>
              <Link href="/search" className="sb-item"><span className="sb-dot green" />Search</Link>
              <Link href="/intelligence" className="sb-item"><span className="sb-dot green" />Intelligence</Link>
            </div>
          </div>
          <Link href="/login" className="sb-profile">Log in →</Link>
        </aside>

        {/* ── Center + right ── */}
        <div className="shell-main">
          <div className="drug-grid">
            {/* ── Main ── */}
            <div className="dg-main">
          <V1DrugSearch initial={drug.generic_name} />

          <div className="d-identity">
            <div className="d-name">{drug.generic_name}</div>
            <div className="d-generic">
              {[drug.atc_code ? `ATC ${drug.atc_code}` : null, klass].filter(Boolean).join(" · ") || "—"}
            </div>
            {drug.brand_names?.length > 0 && (
              <div className="d-tags">{drug.brand_names.slice(0, 4).map((b: string) => <span key={b} className="d-tag">{b}</span>)}</div>
            )}
          </div>

          {/* Status card */}
          <div className={`status-card ${localShortage ? (isCrit ? "crit" : "med") : "ok"}`}>
            <div className="sc-label"><span className="d" />{localShortage ? (anticipated ? `Anticipated · ${cName}` : `In declared shortage · ${cName}`) : `In supply · ${cName}`}</div>
            <div className="sc-title">{localShortage ? (anticipated ? "Anticipated shortage" : isCrit ? "Critical shortage" : "Limited supply") : `In supply in ${cName}`}</div>
            {localShortage && mine?.reason && <div className="sc-sub">{String(mine.reason).replace(/^availability:\s*/i, "")}</div>}
            {!localShortage && elsewhereCount > 0 && <div className="sc-sub">⚠ In shortage in {elsewhereCount} other market{elsewhereCount !== 1 ? "s" : ""} — see regulator status below.</div>}
            {!localShortage && elsewhereCount === 0 && <div className="sc-sub">No active shortage reported.</div>}
            <div className="sc-asof">{localShortage ? `Based on ${expSource} notice · verified ${timeAgo(mine?.last_verified_at ?? mine?.updated_at) || "recently"}` : "Source: official regulators"}</div>
          </div>

          {/* So-what tiles */}
          <div className="sw-cards">
            <div className="sw-card">
              <div className="sw-h"><span className="sw-ic ok">✓</span> Can I substitute?</div>
              <div className="sw-v">{s19aText ? "Yes — under S19A" : "Per normal rules"}</div>
              <div className="sw-d">{s19aText ? "TGA-approved overseas product" : "Confirm with prescriber"}</div>
            </div>
            <div className="sw-card">
              <div className="sw-h"><span className="sw-ic ok">⇄</span> Best alternative</div>
              <div className="sw-v">{topAlt ? topAlt.name : "None listed"}</div>
              <div className="sw-d">{topAlt ? `${topAlt.pct != null ? `${topAlt.pct}% match · ` : ""}${topAlt.rel}` : "refer to prescriber"}</div>
            </div>
            <div className="sw-card">
              <div className="sw-h"><span className="sw-ic neutral">◷</span> Expected back</div>
              <div className="sw-v">{expected ?? "No estimate"}</div>
              <div className="sw-d">{expected ? `Sponsor est. via ${expSource}` : "No estimate provided"}</div>
            </div>
            <Link href="/login" className="sw-card emph">
              <div className="sw-h"><span className="sw-ic grad">↯</span> Source it now</div>
              <div className="sw-v">Request via Mederti</div>
              <div className="sw-d">Connect with suppliers</div>
            </Link>
          </div>

          {/* Substitution pathways (AU only) */}
          {userCountry === "AU" && (
            <div className="sec">
              <div className="sec-title">Substitution pathways <span className="help">🇦🇺 Australia · TGA</span></div>
              <div className="subpath">
                <div className="subpath-row">
                  <div className="subpath-l">
                    <span className={`subpath-ic ${s19aText ? "ok" : "neutral"}`}>{s19aText ? "✓" : "—"}</span>
                    <div>
                      <div className="subpath-n">{s19aText ? "Section 19A approval in force" : "No substitution instrument in force"}</div>
                      <div className="subpath-d">{s19aText || "Dispense per normal rules, or refer to the prescriber. No active SSSI/S19A instrument detected for this medicine."}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* History + reason breakdown — two columns */}
          {(history || showReasons) && (
            <div className="sec sec-2col">
              {history && (
                <div>
                  <div className="sec-title">How long have past shortages lasted? <span className="help">from {history.n} resolved event{history.n > 1 ? "s" : ""}</span></div>
                  <div className="subpath"><div className="subpath-row"><div className="subpath-l"><span className="subpath-ic neutral">◷</span><div>
                    <div className="subpath-n">{history.lo === history.hi ? `~${history.lo} month${history.lo > 1 ? "s" : ""}` : `${history.lo}–${history.hi} months`}</div>
                    <div className="subpath-d">Historical pattern from resolved shortage records — not a prediction of this event.</div>
                  </div></div></div></div>
                </div>
              )}

              {showReasons && (
                <div>
                  <div className="sec-title">Why supply is disrupted <span className="help">across {reasonTotal} recorded event{reasonTotal !== 1 ? "s" : ""}</span></div>
                  <div className="reasons">
                    {reasons.map((r) => (
                      <div key={r.label} className="reason-row">
                        <div className="reason-l"><span className="reason-n">{r.label}</span><span className="reason-c">{r.n}</span></div>
                        <div className="reason-bar"><span style={{ width: `${r.pct}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* API supply-base concentration (FDA Drug Master Files) */}
          {apiConcentration && (
            <div className="sec">
              <div className="sec-title">Global API supply base <span className="help">🇺🇸 FDA Drug Master Files · active Type II</span></div>
              <div className="conc">
                <div className="conc-head">
                  <div>
                    <div className="conc-n">{apiConcentration.count} API manufacturer{apiConcentration.count !== 1 ? "s" : ""}</div>
                    <div className="conc-d">Manufacturers with an active Type II Drug Master File — i.e. cleared to supply this active ingredient into the US market. A proxy for how concentrated the global manufacturing base is.</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                    <span className={`status-pill ${CONC_CLS[apiConcentration.band]}`}><span className="d" />{CONC_LABEL[apiConcentration.band]} concentration risk</span>
                    {(apiConcentration.whoPqCount ?? 0) > 0 && (
                      <span className="who-pq-badge">✓ {apiConcentration.whoPqCount} WHO-prequalified</span>
                    )}
                  </div>
                </div>
                {apiConcentration.makers.length > 0 && (
                  <div className="conc-makers">
                    {apiConcentration.makers.map((m) => <span key={m} className="d-tag">{m}</span>)}
                    {apiConcentration.count > apiConcentration.makers.length && (
                      <span className="d-tag">+{apiConcentration.count - apiConcentration.makers.length} more</span>
                    )}
                  </div>
                )}
                <div className="conc-foot">
                  {apiConcentration.countries.length > 0
                    ? `Manufacturing countries: ${apiConcentration.countries.join(", ")} · `
                    : "Country of manufacture not yet mapped · "}
                  Source: FDA List of Drug Master Files
                </div>
              </div>
            </div>
          )}

          {/* FDA approval footprint — market depth (generic competition) */}
          {approvalFootprint && (
            <div className="sec">
              <div className="sec-title">FDA-approved products <span className="help">🇺🇸 Drugs@FDA</span></div>
              <div className="stat-row">
                <div className="stat-cell">
                  <div className="stat-v">{approvalFootprint.total}</div>
                  <div className="stat-l">Approved applications</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-v">{approvalFootprint.generics}</div>
                  <div className="stat-l">Generic (ANDA)</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-v">{approvalFootprint.brands}</div>
                  <div className="stat-l">Brand (NDA/BLA)</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-v">{monthYear(approvalFootprint.latest) ?? "—"}</div>
                  <div className="stat-l">Latest approval</div>
                </div>
              </div>
              {approvalFootprint.generics > 0 && (
                <div className="stat-foot">{approvalFootprint.generics} approved generic{approvalFootprint.generics !== 1 ? "s" : ""} — more competitors generally means a more resilient supply.</div>
              )}
            </div>
          )}

          {/* Alternatives */}
          {alts.length > 0 && (
            <div className="sec">
              <div className="sec-title">Related alternatives <span className="help">same class</span></div>
              <div className="alt-list">
                {alts.map((a, i) => (
                  <div key={i} className="alt-card alt-rich">
                    <div className="alt-main">
                      <div className="alt-n">{a.name}</div>
                      <div className="alt-f">{a.rel}</div>
                      {a.note && <div className="alt-note">{a.note}</div>}
                    </div>
                    {a.pct != null && (
                      <div className="alt-match">
                        <div className="alt-bar"><span style={{ width: `${a.pct}%` }} /></div>
                        <div className="alt-pct">{a.pct}% match</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Regulator status */}
          {regulators.length > 0 && (
            <div className="sec">
              <div className="sec-title">Shortage status by regulator <span className="help">official notices</span></div>
              <div className="country-list">
                {regulators.map((s, i) => {
                  const cc = (s.country_code || "").toUpperCase();
                  const r = SEV[(s.severity || "").toLowerCase()] ?? 0;
                  const cls = (s.status || "").toLowerCase() === "resolved" ? "sp-ok" : r >= 2 ? "sp-crit" : "sp-part";
                  const lbl = (s.status || "").toLowerCase() === "resolved" ? "Resolved" : `${(s.severity || "shortage")[0].toUpperCase()}${(s.severity || "hortage").slice(1)}`;
                  return (
                    <div key={i} className="country-row">
                      <div className="cl"><span className="flag">{flag(cc)}</span><div><div className="cn">{COUNTRY[cc] ?? cc}</div><div className="alt-f">{abbr(s.data_sources?.name, s.data_sources?.abbreviation)} · {timeAgo(s.last_verified_at ?? s.updated_at)}</div></div></div>
                      <span className={`status-pill ${cls}`}><span className="d" />{lbl}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recalls */}
          {recallList.length > 0 && (
            <div className="sec">
              <div className="sec-title">Recalls <span className="help">official enforcement reports</span></div>
              <div className="country-list">
                {recallList.map((r, i) => {
                  const cc = (r.country_code || "").toUpperCase();
                  const isClassI = (r.recall_class || "").toString().replace(/class\s*/i, "").trim() === "I";
                  const active = (r.status || "").toLowerCase() !== "terminated" && (r.status || "").toLowerCase() !== "completed";
                  const cls = isClassI && active ? "sp-crit" : "sp-part";
                  return (
                    <div key={i} className="country-row">
                      <div className="cl">
                        <span className="flag">{flag(cc)}</span>
                        <div>
                          <div className="cn">{r.brand_name || r.generic_name || "Recall"}</div>
                          <div className="alt-f">{[r.manufacturer, monthYear(r.announced_date)].filter(Boolean).join(" · ") || "—"}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className={`status-pill ${cls}`}><span className="d" />Class {(r.recall_class || "?").toString().replace(/class\s*/i, "").trim() || "?"}</span>
                        {r.press_release_url && <a className="src-link" href={r.press_release_url} target="_blank" rel="noopener noreferrer">details ↗</a>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Timeline */}
          {events.length > 0 && (
            <div className="sec">
              <div className="sec-title">Verified timeline <span className="help">regulator events</span></div>
              <div className="timeline">
                {events.map((e, i) => (
                  <div key={i} className="tl-row">
                    <span className={`tl-d ${e.resolved ? "filled" : ""}`} />
                    <div><div className="tl-dt">{flag(e.cc)} {new Date(e.date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</div><div className="tl-ev">{e.txt}</div></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sources */}
          {sources.length > 0 && (
            <div className="sec">
              <div className="sec-title">Sources <span className="help">official regulators</span></div>
              <div className="src-list">
                {sources.map((s, i) => (
                  <div key={i} className="src-item">
                    <div className="src-l"><span className="flag">{flag(s.cc)}</span><div><div className="src-n">{s.a}</div><div className="alt-f">verified {timeAgo(s.ver) || "recently"}</div></div></div>
                    {s.url && <a className="src-link" href={s.url} target="_blank" rel="noopener noreferrer">verify ↗</a>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="sec"><ClinicalDisclaimer /></div>
        </div>

        {/* ── Chat column ── */}
        <aside className="chat-col">
          <V1Chat drugName={drug.generic_name} />
        </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@500&family=Inter:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
.v1home .d-name,.v1home .sc-title,.v1home .sec-title,.v1home .chat-title{font-family:'Google Sans Flex','Inter',sans-serif;font-weight:500}
.v1home{--ink:#0a0f1a;--green:#10b981;--green-d:#059669;--green-bg:#ecfdf5;--green-b:#a7f3d0;--grad-soft:linear-gradient(135deg,#34d399,#10b981 45%,#0a0f1a 120%);--grad-brand:linear-gradient(135deg,#0a0f1a,#0c3a30 48%,#34d399);
  --violet:#6366f1;--violet-b:#c7d2fe;--bg:#fff;--bg-2:#f7f9fb;--bg-3:#eef2f6;--border:#e6eaf0;--border-2:#d3dae3;
  --text:#0a0f1a;--text-2:#3a4452;--text-3:#697586;--text-4:#9aa4b2;--crit:#e11d48;--crit-b:#fecdd3;--med:#d97706;--med-b:#fde68a;--ok:#10b981;--ok-bg:#ecfdf5;--ok-b:#a7f3d0;--crit-bg:#fff1f3;--med-bg:#fffbeb;
  background:var(--bg-2);color:var(--text);font-family:'Inter',sans-serif;font-size:14px;letter-spacing:-.006em;-webkit-font-smoothing:antialiased;min-height:100vh}
.v1home *{box-sizing:border-box}
.v1home .brand{display:inline-flex;align-items:center;gap:9px;font-weight:800;font-size:18px;letter-spacing:-.03em;color:var(--ink);text-decoration:none}
.v1home .logo-img{height:24px;width:auto;display:block}
.v1home .btn{border:1px solid var(--border);background:var(--bg);color:var(--text-2);padding:9px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none}
.home-nav{position:sticky;top:0;z-index:50;height:58px;background:rgba(255,255,255,.85);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 24px}
.nav-actions{display:flex;gap:10px;align-items:center}
.shell{display:flex;align-items:flex-start;min-height:100vh}
.sb{width:262px;flex-shrink:0;border-right:1px solid var(--border);background:var(--bg);position:sticky;top:0;height:100vh;display:flex;flex-direction:column}
.sb-top{padding:18px 18px 14px}
.sb-new{margin:0 14px 10px;display:flex;align-items:center;gap:8px;justify-content:center;padding:11px;border:1px solid var(--border);border-radius:12px;font-size:13px;font-weight:600;color:var(--text-2);background:var(--bg);text-decoration:none}
.sb-new:hover{border-color:var(--green);color:var(--green-d);background:var(--green-bg)}
.sb-scroll{flex:1;overflow-y:auto;padding:8px 14px}
.sb-group{margin-top:14px}
.sb-glabel{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-4);padding:6px 8px}
.sb-item{display:flex;align-items:center;gap:10px;padding:9px;border-radius:10px;font-size:13px;font-weight:500;color:var(--text-2);text-decoration:none}
.sb-item:hover{background:var(--bg-2)}
.sb-empty{color:var(--text-4);font-style:italic}
.sb-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.sb-dot.green{background:var(--ok)}
.sb-profile{border-top:1px solid var(--border);padding:16px;font-size:13px;font-weight:600;color:var(--text-2);text-decoration:none}
.sb-profile:hover{color:var(--green-d)}
.shell-main{flex:1;min-width:0}
.drug-grid{display:flex;align-items:flex-start}
.dg-main{flex:1;min-width:0;max-width:1180px;padding:18px 40px 80px;width:100%}
.dsearch{display:flex;align-items:center;gap:8px;margin:18px 0 0;background:var(--bg);border:1.5px solid var(--border-2);border-radius:12px;padding:5px 6px 5px 14px;transition:.15s}
.dsearch:focus-within{border-color:var(--green);box-shadow:0 8px 24px -16px rgba(16,185,129,.4)}
.dsearch-ic{color:var(--text-4);font-size:16px}
.dsearch input{flex:1;border:none;outline:none;background:transparent;font-size:15px;font-family:inherit;color:var(--text);padding:9px 0}
.dsearch input::placeholder{color:var(--text-4)}
.dsearch button{background:var(--green);color:#fff;border:none;padding:9px 16px;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;flex-shrink:0}
.dsearch button:hover{background:var(--green-d)}
.d-identity{padding:16px 0 0}
.d-name{font-size:30px;font-weight:700;letter-spacing:-.032em;line-height:1.1}
.d-generic{font-size:13px;color:var(--text-3);margin-top:5px;font-family:'DM Mono',monospace}
.d-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}
.d-tag{font-size:11px;font-weight:500;padding:4px 9px;border-radius:7px;background:var(--bg-3);color:var(--text-3);border:1px solid var(--border)}
.status-card{margin:18px 0 0;border-radius:18px;padding:20px}
.status-card.crit{background:linear-gradient(135deg,#fff5f6,#fff1f3);border:1px solid var(--crit-b)}
.status-card.med{background:linear-gradient(135deg,#fffdf5,#fffbeb);border:1px solid var(--med-b)}
.status-card.ok{background:linear-gradient(135deg,#f0fdf8,#ecfdf5);border:1px solid var(--ok-b)}
.sc-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.078em;margin-bottom:7px;display:flex;align-items:center;gap:7px}
.status-card.crit .sc-label{color:var(--crit)}.status-card.med .sc-label{color:var(--med)}.status-card.ok .sc-label{color:var(--ok)}
.sc-label .d{width:7px;height:7px;border-radius:50%;background:currentColor}
.sc-title{font-size:24px;font-weight:700;letter-spacing:-.028em;margin-bottom:5px}
.sc-sub{font-size:13px;color:var(--text-3)}
.sc-asof{font-size:11px;color:var(--text-4);font-family:'DM Mono',monospace;margin-top:12px}
.sw-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px}
.sw-card{background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:13px 13px;text-decoration:none;color:inherit;display:block}
.sw-card.emph{background:linear-gradient(150deg,var(--green-bg),var(--bg) 80%);border-color:var(--green-b)}
.sw-h{display:flex;align-items:center;gap:6px;font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--text-4)}
.sw-ic{width:16px;height:16px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;flex-shrink:0}
.sw-ic.ok{background:var(--green-bg);color:var(--green-d);border:1px solid var(--green-b)}
.sw-ic.neutral{background:var(--bg-3);color:var(--text-3);border:1px solid var(--border)}
.sw-ic.grad{background:var(--grad-brand);color:#fff}
.sw-v{font-size:13.5px;font-weight:700;letter-spacing:-.02em;color:var(--ink);margin-top:8px;line-height:1.2}
.sw-d{font-size:10px;color:var(--text-3);margin-top:4px}
.sec{margin-top:30px}
.sec-2col{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}
@media(max-width:760px){.sec-2col{grid-template-columns:1fr;gap:30px}}
.sec-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.078em;color:var(--text-4);margin-bottom:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sec-title .help{color:var(--text-4);font-weight:400;text-transform:none;letter-spacing:0;font-size:11px}
.subpath{border:1px solid var(--border);border-radius:14px;overflow:hidden;background:var(--bg)}
.subpath-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 16px}
.subpath-l{display:flex;gap:12px;align-items:flex-start;min-width:0}
.subpath-ic{width:22px;height:22px;border-radius:7px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;margin-top:1px}
.subpath-ic.ok{background:var(--green-bg);color:var(--green-d);border:1px solid var(--green-b)}
.subpath-ic.neutral{background:var(--bg-3);color:var(--text-4);border:1px solid var(--border)}
.subpath-n{font-size:13.5px;font-weight:600;letter-spacing:-.01em;color:var(--ink)}
.subpath-d{font-size:12px;color:var(--text-3);line-height:1.5;margin-top:3px}
.alt-list{display:flex;flex-direction:column;gap:9px}
.alt-card{background:var(--bg);border:1px solid var(--border);border-radius:13px;padding:14px 16px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.alt-main{min-width:0}
.alt-n{font-size:14px;font-weight:600;margin-bottom:3px}
.alt-f{font-size:11px;color:var(--text-4);font-family:'DM Mono',monospace}
.alt-note{font-size:11.5px;color:var(--text-3);margin-top:6px;line-height:1.45}
.alt-match{display:flex;flex-direction:column;align-items:flex-end;gap:4px;min-width:110px}
.alt-bar{width:96px;height:5px;border-radius:99px;background:var(--bg-3);overflow:hidden}
.alt-bar span{display:block;height:100%;border-radius:99px;background:var(--grad-soft)}
.alt-pct{font-size:10.5px;color:var(--text-4);font-family:'DM Mono',monospace}
.country-list{display:flex;flex-direction:column;gap:9px}
.country-row{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-radius:13px;background:var(--bg);border:1px solid var(--border)}
.cl{display:flex;align-items:center;gap:11px}
.cn{font-size:14px;font-weight:600}
.flag{font-size:18px}
.timeline{display:flex;flex-direction:column;gap:14px;padding-left:2px}
.tl-row{display:flex;gap:11px;align-items:flex-start}
.tl-d{width:9px;height:9px;border-radius:50%;border:2px solid var(--border-2);background:var(--bg);margin-top:3px;flex-shrink:0}
.tl-d.filled{background:var(--green);border-color:var(--green)}
.tl-dt{font-size:11px;color:var(--text-4);font-family:'DM Mono',monospace}
.tl-ev{font-size:12.5px;color:var(--text-2);margin-top:1px}
.src-list{display:flex;flex-direction:column;gap:7px}
.src-item{display:flex;align-items:center;justify-content:space-between;padding:10px 13px;border-radius:11px;background:var(--bg);border:1px solid var(--border)}
.src-l{display:flex;align-items:center;gap:9px}
.src-n{font-size:12px;font-weight:600}
.src-link{font-size:11px;color:var(--green-d);font-family:'DM Mono',monospace;font-weight:500;text-decoration:none}
.conc{border:1px solid var(--border);border-radius:14px;background:var(--bg);padding:16px}
.conc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
.conc-n{font-size:18px;font-weight:700;letter-spacing:-.02em;color:var(--ink)}
.conc-d{font-size:12px;color:var(--text-3);line-height:1.5;margin-top:4px;max-width:520px}
.who-pq-badge{font-size:10.5px;font-weight:600;color:var(--green-d);background:var(--green-bg);border:1px solid var(--green-b);padding:3px 9px;border-radius:99px;white-space:nowrap}
.conc-makers{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}
.conc-foot{font-size:11px;color:var(--text-4);font-family:'DM Mono',monospace;margin-top:13px;border-top:1px solid var(--border);padding-top:11px}
.reasons{display:flex;flex-direction:column;gap:11px;background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:16px}
.reason-row{display:flex;flex-direction:column;gap:6px}
.reason-l{display:flex;align-items:center;justify-content:space-between}
.reason-n{font-size:13px;font-weight:600;color:var(--ink)}
.reason-c{font-size:11px;color:var(--text-4);font-family:'DM Mono',monospace}
.reason-bar{height:6px;border-radius:99px;background:var(--bg-3);overflow:hidden}
.reason-bar span{display:block;height:100%;border-radius:99px;background:var(--grad-soft)}
.stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.stat-cell{background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:14px 13px}
.stat-v{font-size:20px;font-weight:700;letter-spacing:-.02em;color:var(--ink);line-height:1.1}
.stat-l{font-size:10.5px;color:var(--text-3);margin-top:5px;text-transform:uppercase;letter-spacing:.04em}
.stat-foot{font-size:11.5px;color:var(--text-3);margin-top:11px;line-height:1.5}
@media(max-width:620px){.stat-row{grid-template-columns:repeat(2,1fr)}}
.status-pill{font-size:11px;font-weight:600;padding:4px 10px;border-radius:99px;white-space:nowrap;display:inline-flex;align-items:center;gap:5px}
.status-pill .d{width:6px;height:6px;border-radius:50%;background:currentColor}
.sp-crit{color:var(--crit);background:var(--crit-bg);border:1px solid var(--crit-b)}
.sp-part{color:var(--med);background:var(--med-bg);border:1px solid var(--med-b)}
.sp-ok{color:var(--ok);background:var(--ok-bg);border:1px solid var(--ok-b)}
.chat-col{width:380px;flex-shrink:0;border-left:1px solid var(--border);background:var(--bg);position:sticky;top:0;height:100vh}
.chat-panel{display:flex;flex-direction:column;height:100%}
.chat-head{display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid var(--border)}
.chat-h-l{display:flex;align-items:center;gap:10px}
.chat-ic{font-size:16px;color:var(--violet)}
.chat-title{font-size:13.5px;font-weight:700}
.chat-sub{font-size:11px;color:var(--text-4)}
.chat-free-tag{font-size:9.5px;font-weight:700;letter-spacing:.06em;color:var(--green-d);background:var(--green-bg);border:1px solid var(--green-b);padding:2px 7px;border-radius:6px}
.chat-stream{padding:16px;flex:1;overflow-y:auto}
.chat-bubble{background:var(--bg-2);border:1px solid var(--border);border-radius:4px 13px 13px 13px;padding:11px 13px;font-size:12.5px;color:var(--text-2);line-height:1.5}
.chat-suggest{display:flex;flex-direction:column;gap:7px;padding:0 16px 12px}
.chat-q{text-align:left;font-size:12px;color:var(--text-2);background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:9px 12px;text-decoration:none;transition:.12s}
.chat-q:hover{border-color:var(--violet);color:var(--violet)}
.chat-input{display:flex;align-items:center;gap:8px;margin:0 16px 16px;padding:9px 9px 9px 14px;border:1px solid var(--border);border-radius:12px;background:var(--bg);text-decoration:none}
.chat-input input{flex:1;border:none;background:transparent;outline:none;font-size:13px;font-family:inherit;color:var(--text)}
.chat-input input::placeholder{color:var(--text-4)}
.chat-send{width:30px;height:30px;border-radius:8px;background:var(--ink);color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}
.chat-send:disabled{opacity:.5;cursor:default}
@media(max-width:1080px){.chat-col{display:none}.dg-main{margin:0 auto}}
@media(max-width:820px){.sb{display:none}}
@media(max-width:620px){.sw-cards{grid-template-columns:repeat(2,1fr)}.d-name{font-size:24px}}
`;
