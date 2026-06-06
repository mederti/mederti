"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, type DrugHit } from "@/lib/api";
import V1CountryPicker from "@/app/components/v1/V1CountryPicker";
import { truncateDrugName } from "@/lib/utils";
import { cleanBrandNames } from "@/lib/brand";

function statusOf(d: DrugHit): { cls: string; label: string } {
  if (d.source === "catalogue") return { cls: "sp-ok", label: "Registered product" };
  const n = d.active_shortage_count ?? 0;
  if (n >= 5) return { cls: "sp-crit", label: `${n} active shortages` };
  if (n >= 1) return { cls: "sp-part", label: `${n} active shortage${n > 1 ? "s" : ""}` };
  return { cls: "sp-ok", label: "In supply" };
}

function Results() {
  const params = useSearchParams();
  const router = useRouter();
  const initialQ = params.get("q") ?? "";
  const [q, setQ] = useState(initialQ);
  const [results, setResults] = useState<DrugHit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (term: string) => {
    if (!term.trim()) { setResults([]); setTotal(0); return; }
    setLoading(true);
    try {
      const data = await api.search(term, 25);
      setResults(data.results);
      setTotal(data.total);
    } catch {
      setResults([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (initialQ) search(initialQ); }, [initialQ, search]);

  function onChange(v: string) {
    setQ(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      router.replace(v.trim() ? `/search?q=${encodeURIComponent(v.trim())}` : "/search", { scroll: false });
      search(v);
    }, 200);
  }

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

      {q.trim() && (
        <div className="results-head"><div className="rh">{loading ? "Searching…" : <>Results for <b>{q.trim()}</b>{total > 0 ? ` · ${total}` : ""}</>}</div></div>
      )}

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
          return d.source === "catalogue"
            ? <div key={d.drug_id}>{inner}</div>
            : <Link key={d.drug_id} href={`/drugs/${d.drug_id}`} style={{ textDecoration: "none", color: "inherit" }}>{inner}</Link>;
        })}
      </div>

      {!loading && q.trim() && results.length === 0 && (
        <div className="res-foot">No results for &ldquo;{q.trim()}&rdquo;. Try the generic or brand name.</div>
      )}
      {results.length > 0 && <div className="res-foot">Status from official regulators · tap a result for full detail</div>}
    </>
  );
}

export default function SearchPage() {
  return (
    <div className="v1home v1search">
      <style>{CSS}</style>
      <div className="shell">
        {/* ── Left sidebar (app nav) — identical to the drug page shell ── */}
        <aside className="sb">
          <div className="sb-top">
            <Link href="/" className="brand" aria-label="Mederti home">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-black.png" alt="mederti" className="logo-img" />
            </Link>
          </div>
          <div style={{ padding: "14px 14px 8px 16px" }}><V1CountryPicker /></div>
          <div className="sb-scroll">
            <div className="sb-group">
              <div className="sb-glabel">My medicines</div>
              <Link href="/login" className="sb-item sb-empty">Sign in to save medicines</Link>
            </div>
            <div className="sb-group">
              <div className="sb-glabel">Browse</div>
              <Link href="/search" className="sb-item sb-active"><span className="sb-dot green" />Search</Link>
              <Link href="/intelligence" className="sb-item"><span className="sb-dot green" />Intelligence</Link>
            </div>
          </div>
          <Link href="/login" className="sb-profile">Log in →</Link>
        </aside>

        {/* ── Center column (no right-hand chat column) ── */}
        <div className="shell-main">
          <div className="dg-main">
            <Suspense fallback={<div style={{ height: 80 }} />}>
              <Results />
            </Suspense>
          </div>
        </div>
      </div>
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
.sb-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.sb-dot.green{background:var(--ok)}
.sb-profile{border-top:1px solid var(--border);padding:16px;font-size:13px;font-weight:600;color:var(--text-2);text-decoration:none}
.sb-profile:hover{color:var(--green-d)}
.shell-main{flex:1;min-width:0}
.dg-main{flex:1;min-width:0;max-width:900px;padding:32px 40px 80px;width:100%}

/* ── Search box + results ── */
.searchbox.v1sb{display:flex;align-items:center;gap:8px;background:var(--bg);border:1.5px solid var(--border-2);border-radius:14px;padding:6px 8px 6px 18px;box-shadow:0 12px 36px -22px rgba(10,15,26,.28);transition:.15s}
.searchbox.v1sb:focus-within{border-color:var(--green);box-shadow:0 12px 36px -18px rgba(16,185,129,.4)}
.searchbox .ic{color:var(--text-4);font-size:17px}
.searchbox.v1sb input{flex:1;border:none;outline:none;font-size:15px;font-family:inherit;background:transparent;color:var(--text);padding:10px 0}
.searchbox.v1sb input::placeholder{color:var(--text-4)}
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

@media(max-width:820px){.sb{display:none}.dg-main{margin:0 auto;padding:24px 20px 80px}}
`;
