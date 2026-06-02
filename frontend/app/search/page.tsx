"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, type DrugHit } from "@/lib/api";
import V1CountryPicker from "@/app/components/v1/V1CountryPicker";
import { truncateDrugName } from "@/lib/utils";

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
                {d.brand_names?.length > 0 && <div className="rg">{d.brand_names.slice(0, 3).join(" · ")}</div>}
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
    <div className="v1home">
      <style>{CSS}</style>
      <nav className="home-nav">
        <Link href="/" className="brand" aria-label="Mederti home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-black.png" alt="mederti" className="logo-img" />
        </Link>
        <div className="nav-actions">
          <V1CountryPicker />
          <Link href="/signup" className="btn btn-primary">Get started free</Link>
          <Link href="/login" className="btn">Log in</Link>
        </div>
      </nav>
      <main className="wrap-narrow">
        <Suspense fallback={<div style={{ height: 80 }} />}>
          <Results />
        </Suspense>
      </main>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@500&family=Inter:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
.v1home .res-l .rn{font-family:'Google Sans Flex','Inter',sans-serif;font-weight:500}
.v1home{--ink:#0a0f1a;--green:#10b981;--green-d:#059669;--green-bg:#ecfdf5;--green-b:#a7f3d0;
  --bg:#fff;--bg-2:#f7f9fb;--bg-3:#eef2f6;--border:#e6eaf0;--border-2:#d3dae3;
  --text:#0a0f1a;--text-2:#3a4452;--text-3:#697586;--text-4:#9aa4b2;
  --crit:#e11d48;--crit-bg:#fff1f3;--crit-b:#fecdd3;--med:#d97706;--med-bg:#fffbeb;--med-b:#fde68a;--ok:#10b981;--ok-bg:#ecfdf5;--ok-b:#a7f3d0;
  background:var(--bg-2);color:var(--text);font-family:'Inter',sans-serif;font-size:14px;letter-spacing:-.006em;-webkit-font-smoothing:antialiased;min-height:100vh}
.v1home *{box-sizing:border-box}
.v1home .brand{display:inline-flex;align-items:center;gap:9px;font-weight:800;font-size:18px;letter-spacing:-.03em;color:var(--ink);text-decoration:none}
.v1home .logo-img{height:26px;width:auto;display:block}
.v1home .btn{border:1px solid var(--border);background:var(--bg);color:var(--text-2);padding:9px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;transition:.15s}
.v1home .btn:hover{border-color:var(--border-2);background:var(--bg-2)}
.v1home .btn-primary{background:var(--green);border-color:var(--green);color:#fff;box-shadow:0 8px 20px -8px rgba(16,185,129,.55)}
.v1home .btn-primary:hover{background:var(--green-d)}
.home-nav{position:sticky;top:0;z-index:50;height:64px;background:transparent;display:flex;align-items:center;justify-content:space-between;padding:0 28px}
.nav-actions{display:flex;gap:10px;align-items:center}
.wrap-narrow{max-width:680px;margin:0 auto;padding:32px 24px 80px}
.searchbox.v1sb{display:flex;align-items:center;gap:8px;background:var(--bg);border:1.5px solid var(--border-2);border-radius:14px;padding:6px 8px 6px 18px;box-shadow:0 12px 36px -22px rgba(10,15,26,.28);transition:.15s}
.searchbox.v1sb:focus-within{border-color:var(--green);box-shadow:0 12px 36px -18px rgba(16,185,129,.4)}
.searchbox .ic{color:var(--text-4);font-size:17px}
.searchbox.v1sb input{flex:1;border:none;outline:none;font-size:15px;font-family:inherit;background:transparent;color:var(--text);padding:10px 0}
.searchbox.v1sb input::placeholder{color:var(--text-4)}
.results-head{padding:22px 2px 4px}
.results-head .rh{font-size:12px;color:var(--text-3)}
.results-head .rh b{color:var(--text);font-weight:700}
.res-list{padding:10px 0 0;display:flex;flex-direction:column;gap:9px}
.res-card{background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:15px 17px;display:flex;align-items:center;justify-content:space-between;gap:12px;transition:transform .16s,box-shadow .16s,border-color .16s;cursor:pointer}
.res-card:hover{border-color:var(--green);box-shadow:0 12px 28px -20px rgba(16,185,129,.5);transform:translateY(-1px)}
.res-l{min-width:0}
.res-l .rn{font-size:15px;font-weight:700;letter-spacing:-.02em}
.res-l .rg{font-size:12px;color:var(--text-3);font-family:'DM Mono',monospace;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.res-l .rmeta{font-size:11px;color:var(--text-4);margin-top:6px}
.res-foot{padding:24px 0;text-align:center;font-size:12px;color:var(--text-4)}
.status-pill{font-size:11px;font-weight:600;padding:5px 11px;border-radius:99px;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;flex-shrink:0}
.status-pill .d{width:6px;height:6px;border-radius:50%;background:currentColor}
.sp-crit{color:var(--crit);background:var(--crit-bg);border:1px solid var(--crit-b)}
.sp-part{color:var(--med);background:var(--med-bg);border:1px solid var(--med-b)}
.sp-ok{color:var(--ok);background:var(--ok-bg);border:1px solid var(--ok-b)}
`;
