"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import V1Sidebar from "@/app/components/v1/V1Sidebar";
import { truncateDrugName } from "@/lib/utils";
import { cleanBrandNames } from "@/lib/brand";
import { addRecentMedicine } from "@/lib/recent-activity";
import type { DrugHit } from "@/lib/api";
import { X } from "lucide-react";

// ── Display helpers (mirrors /search so the table reads identically) ──────
const SCHEME_SHORT: Record<string, string> = {
  tga_s19a: "S19A", mhra_ssp: "SSP", dhsc_msn: "MSN",
  fda_503b: "503B", fda_shortage: "FDA list", eu_art_5_2: "Art 5(2)",
};
function statusOf(d: DrugHit): { cls: string; label: string } {
  const n = d.active_shortage_count ?? 0;
  if (n >= 5) return { cls: "sp-crit", label: `${n} active shortages` };
  if (n >= 1) return { cls: "sp-part", label: `${n} active shortage${n > 1 ? "s" : ""}` };
  return { cls: "sp-ok", label: "In supply" };
}
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

// Country-first supply verdict (same logic /search uses).
function marketStatus(
  d: DrugHit, market: string
): { cls: string; label: string; sub: string | null; warn: boolean } {
  const active = d.active_shortage_count ?? 0;
  const other = d.other_markets_short ?? 0;
  if (active > 0) {
    const cls = (d.market_severity ?? 0) >= 2 ? "sp-crit" : "sp-part";
    return { cls, label: `Short in ${market}`, sub: other > 0 ? `+ ${other} other market${other > 1 ? "s" : ""} short` : null, warn: true };
  }
  return {
    cls: "sp-ok",
    label: `Available in ${market}`,
    sub: other > 0 ? `short in ${other} other market${other > 1 ? "s" : ""}` : "no active shortages",
    warn: other > 0,
  };
}

function readMarketCookie(): string {
  if (typeof document === "undefined") return "AU";
  const m = document.cookie.match(/(?:^|; )mederti-country=([A-Za-z]{2})/);
  return m ? m[1].toUpperCase() : "AU";
}

type AuthState = "loading" | "anon" | "ready";

export default function WatchlistPage() {
  const router = useRouter();
  const [auth, setAuth] = useState<AuthState>("loading");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DrugHit[]>([]);
  // Map drug_id → user_watchlists.id so we can soft-delete on remove.
  const [watchIds, setWatchIds] = useState<Record<string, string>>({});
  const market = typeof window !== "undefined" ? readMarketCookie() : "AU";

  const load = useCallback(async () => {
    const supabase = createBrowserClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      setAuth("anon");
      setLoading(false);
      return;
    }
    setAuth("ready");

    // All actively-watched medicines, newest first.
    const { data: wl } = await supabase
      .from("user_watchlists")
      .select("id, drug_id")
      .eq("user_id", session.user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    const items = (wl ?? []).filter((r) => r.drug_id) as { id: string; drug_id: string }[];
    const idMap: Record<string, string> = {};
    for (const r of items) idMap[r.drug_id] = r.id;
    setWatchIds(idMap);

    if (items.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }

    // Enrich with the same table-view signals as /search via the ids mode.
    const ids = items.map((r) => r.drug_id).join(",");
    try {
      const res = await fetch(`/api/search?ids=${encodeURIComponent(ids)}&market=${market}`);
      const json = await res.json();
      setRows((json.results ?? []) as DrugHit[]);
    } catch {
      setRows([]);
    }
    setLoading(false);
  }, [market]);

  useEffect(() => { load(); }, [load]);

  async function remove(drugId: string) {
    const wid = watchIds[drugId];
    setRows((prev) => prev.filter((r) => r.drug_id !== drugId)); // optimistic
    if (!wid) return;
    const supabase = createBrowserClient();
    await supabase.from("user_watchlists").update({ is_active: false }).eq("id", wid);
  }

  const hasTradePrice = rows.some((r) => r.trade_price);

  return (
    <div className="v1home v1watch">
      <style>{CSS}</style>
      <div className="shell">
        <V1Sidebar />
        <div className="shell-main">
          <div className="dg-main">
            <div className="wl-head">
              <h1 className="wl-title">My medicines</h1>
              {auth === "ready" && !loading && (
                <div className="wl-sub">
                  {rows.length > 0
                    ? `${rows.length} saved · supply scoped to ${market}`
                    : "Your saved medicines will appear here"}
                </div>
              )}
            </div>

            {loading && <div className="wl-empty">Loading…</div>}

            {!loading && auth === "anon" && (
              <div className="wl-empty">
                <div className="wl-empty-t">Sign in to see your saved medicines</div>
                <div className="wl-empty-s">
                  Save any medicine from its page to track its supply here.
                </div>
                <Link href="/login?next=/watchlist" className="wl-btn">Log in →</Link>
              </div>
            )}

            {!loading && auth === "ready" && rows.length === 0 && (
              <div className="wl-empty">
                <div className="wl-empty-t">No medicines saved yet</div>
                <div className="wl-empty-s">
                  Search for a medicine and tap the bell on its page to add it to your list.
                </div>
                <Link href="/search" className="wl-btn">Search medicines →</Link>
              </div>
            )}

            {/* ── Desktop table (parity with /search results) ── */}
            {!loading && rows.length > 0 && (
              <div className="res-table-wrap">
                <table className="res-table">
                  <thead>
                    <tr>
                      <th className="c-med">Medicine</th>
                      <th className="c-mkt">In your market</th>
                      <th className="c-sub">Can I substitute?</th>
                      <th className="c-alt">Best alternative</th>
                      <th className="c-n">Alts</th>
                      {hasTradePrice && <th className="c-price">Trade price</th>}
                      <th className="c-eb">Expected back</th>
                      <th className="c-ver">Last verified</th>
                      <th className="c-x" aria-label="Remove" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => {
                      const ms = marketStatus(d, market);
                      const bn = cleanBrandNames(d.brand_names, d.generic_name);
                      const eb = monthYear(d.estimated_resolution_date);
                      const ver = timeAgo(d.last_verified_at);
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
                            ) : (
                              <>
                                <div className="t-norm">Standard substitution</div>
                                <div className="t-sub2">no shortage approval needed</div>
                              </>
                            )}
                          </td>
                          <td>
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
                                <div className="t-price">
                                  {(d.trade_price.currency === "AUD" ? "A$" : d.trade_price.currency + " ")}
                                  {d.trade_price.ex_manufacturer.toFixed(2)}
                                </div>
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
                          <td className="center">
                            <button
                              className="wl-x"
                              aria-label={`Remove ${d.generic_name}`}
                              title="Remove from my medicines"
                              onClick={(e) => { e.stopPropagation(); remove(d.drug_id); }}
                            >
                              <X size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Mobile cards ── */}
            {!loading && rows.length > 0 && (
              <div className="res-list">
                {rows.map((d) => {
                  const st = statusOf(d);
                  const bn = cleanBrandNames(d.brand_names, d.generic_name);
                  return (
                    <div key={d.drug_id} className="res-card">
                      <Link
                        href={`/drugs/${d.drug_id}`}
                        className="res-l"
                        style={{ textDecoration: "none", color: "inherit" }}
                        onClick={() => addRecentMedicine({ id: String(d.drug_id), name: d.generic_name })}
                      >
                        <div className="rn">{truncateDrugName(d.generic_name)}</div>
                        {bn.length > 0 && <div className="rg">{bn.slice(0, 3).join(" · ")}</div>}
                        <div className="rmeta">
                          {d.atc_code ? `ATC ${d.atc_code}` : "—"}
                          {d.alternatives_count ? ` · ${d.alternatives_count} alternative${d.alternatives_count > 1 ? "s" : ""}` : ""}
                        </div>
                      </Link>
                      <div className="res-r">
                        <span className={`status-pill ${st.cls}`}><span className="d" />{st.label}</span>
                        <button className="wl-x" aria-label={`Remove ${d.generic_name}`} onClick={() => remove(d.drug_id)}>
                          <X size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {!loading && rows.length > 0 && (
              <div className="res-foot">Status from official regulators · tap a row for full detail</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.v1home{--ink:#0c1118;--green:#0fa676;--green-d:#0c8a62;--green-bg:#e8f6f0;--green-b:#dcebe6;
  --bg:#ffffff;--bg-2:#fafbfc;--bg-3:#eef2f5;--border:#e8ecf0;--border-2:#dde3e9;
  --text:#0c1118;--text-2:#3b434e;--text-3:#6a7280;--text-4:#98a1ac;
  --crit:#dc2647;--crit-bg:#fdeef1;--crit-b:#f8cdd6;--med:#b46708;--med-bg:#fdf6e9;--med-b:#f3dcae;--ok:#0fa676;--ok-bg:#e8f6f0;--ok-b:#bce4d4;
  --hi-inset:inset 0 1px 0 rgba(255,255,255,.7);--sh-card:0 1px 1px rgba(12,17,24,.04),0 2px 6px -2px rgba(12,17,24,.06);
  background:var(--bg-2);color:var(--text);font-family:var(--font-geist-sans),system-ui,sans-serif;font-size:14px;letter-spacing:-.011em;-webkit-font-smoothing:antialiased;min-height:100vh}
.v1home *{box-sizing:border-box}

.shell{display:flex;align-items:flex-start;min-height:100vh}
.shell-main{flex:1;min-width:0}
.dg-main{flex:1;min-width:0;max-width:1180px;padding:32px 40px 80px;width:100%;background:#eef1f5}

.wl-head{padding:4px 2px 6px}
.wl-title{font-size:22px;font-weight:800;letter-spacing:-.025em;color:var(--ink);margin:0}
.wl-sub{margin-top:5px;font-size:12.5px;color:var(--text-3)}

.wl-empty{margin-top:32px;padding:40px 28px;text-align:center;background:var(--bg);border:1px solid var(--border);border-radius:16px;box-shadow:var(--sh-card),var(--hi-inset)}
.wl-empty-t{font-size:15px;font-weight:700;color:var(--ink)}
.wl-empty-s{margin-top:6px;font-size:13px;color:var(--text-3)}
.wl-btn{display:inline-block;margin-top:16px;padding:9px 16px;border-radius:10px;background:var(--green);color:#fff;font-size:13px;font-weight:600;text-decoration:none}
.wl-btn:hover{background:var(--green-d)}

.status-pill{font-size:11px;font-weight:600;padding:5px 11px;border-radius:99px;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;flex-shrink:0}
.status-pill .d{width:6px;height:6px;border-radius:50%;background:currentColor}
.sp-crit{color:var(--crit);background:var(--crit-bg);border:1px solid var(--crit-b)}
.sp-part{color:var(--med);background:var(--med-bg);border:1px solid var(--med-b)}
.sp-ok{color:var(--ok);background:var(--ok-bg);border:1px solid var(--ok-b)}

.res-table-wrap{display:none;margin-top:16px;background:var(--bg);border:1px solid var(--border);border-radius:16px;overflow:hidden;box-shadow:var(--sh-card),var(--hi-inset)}
.res-table{width:100%;border-collapse:collapse;table-layout:fixed}
.res-table thead th{text-align:left;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-4);padding:13px 16px;background:var(--bg-2);border-bottom:1px solid var(--border);white-space:nowrap}
.res-table th.c-med{width:20%}.res-table th.c-mkt{width:15%}.res-table th.c-sub{width:13%}.res-table th.c-alt{width:14%}.res-table th.c-n{width:6%;text-align:center}.res-table th.c-price{width:10%}.res-table th.c-eb{width:11%}.res-table th.c-ver{width:9%}.res-table th.c-x{width:4%}
.t-price{font-size:13px;font-weight:700;color:var(--ink);font-family:var(--font-geist-mono),ui-monospace,monospace}
.res-table tbody td{padding:14px 16px;border-bottom:1px solid var(--border);vertical-align:top}
.res-table tbody tr:last-child td{border-bottom:none}
.res-table tbody tr.clickable{cursor:pointer;transition:background .12s}
.res-table tbody tr.clickable:hover{background:var(--bg-2)}
.res-table tbody tr.clickable:focus-visible{outline:2px solid var(--green);outline-offset:-2px}
.res-table td.center{text-align:center;vertical-align:top}
.t-name{font-size:14px;font-weight:700;letter-spacing:-.02em;line-height:1.25;color:var(--ink)}
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
.wl-x{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--text-4);cursor:pointer;transition:.12s}
.wl-x:hover{background:var(--crit-bg);border-color:var(--crit-b);color:var(--crit)}

.res-list{margin-top:14px;padding:0;display:flex;flex-direction:column;gap:9px}
.res-card{background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:15px 17px;display:flex;align-items:center;justify-content:space-between;gap:12px;box-shadow:var(--sh-card),var(--hi-inset)}
.res-l{min-width:0;flex:1;display:block}
.res-l .rn{font-size:15px;font-weight:700;letter-spacing:-.02em}
.res-l .rg{font-size:12px;color:var(--text-3);font-family:var(--font-geist-mono),ui-monospace,monospace;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.res-l .rmeta{font-size:11px;color:var(--text-4);margin-top:6px}
.res-r{display:flex;align-items:center;gap:8px;flex-shrink:0}
.res-foot{padding:24px 0;text-align:center;font-size:12px;color:var(--text-4)}

@media(min-width:1024px){.res-table-wrap{display:block}.res-list{display:none}}
@media(max-width:820px){.dg-main{margin:0 auto;padding:24px 20px 80px}}
`;
