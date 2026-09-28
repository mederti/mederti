"use client";

// Watchlist risk board (hospital-pharmacist feedback #5). Signed-in users see
// THEIR watched medicines tiered by forward supply risk — short now, anticipated
// within the planning window, early-warning from peer markets, or quiet — so
// planning is watchlist-first instead of scanning the broad national view.
//
// Reads the watchlist client-side (same RLS-guarded pattern as V1Sidebar) and
// POSTs the ids to /api/watchlist/risk-board. Renders nothing for anonymous
// visitors, so the national dashboard below is unaffected for them.

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { truncateDrugName } from "@/lib/utils";
import {
  TIER_META, TIER_ORDER,
  type RiskItem, type RiskTier, type RiskBoardResponse,
} from "@/lib/watchlist-risk";

function readCountryCookie(): string {
  if (typeof document === "undefined") return "AU";
  const m = document.cookie.match(/(?:^|;\s*)mederti-country=([^;]+)/);
  return (m ? decodeURIComponent(m[1]) : "AU").toUpperCase();
}

const monthYear = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
};

// The one line a pharmacist reads per row — what's happening and the timeframe.
function detailFor(it: RiskItem, windowDays: number): string {
  switch (it.tier) {
    case "short_now": {
      const back = monthYear(it.est_return);
      return back ? `Short now · est. back ${back}` : "Short now · no return estimate";
    }
    case "anticipated": {
      const start = monthYear(it.anticipated_start);
      if (it.days_until != null && it.days_until >= 0) {
        const soon = it.days_until <= windowDays ? " — within planning window" : "";
        return `Expected to start ${start ?? `in ~${it.days_until} days`}${soon}`;
      }
      return start ? `Anticipated shortage (from ${start})` : "Anticipated shortage flagged";
    }
    case "early_warning":
      return `Short in ${it.peer_count} peer market${it.peer_count === 1 ? "" : "s"}: ${it.peers.slice(0, 6).join(", ")}`;
    default:
      return "In supply in your market";
  }
}

export function WatchlistRiskBoard() {
  const [status, setStatus] = useState<"loading" | "anon" | "empty" | "ready">("loading");
  const [data, setData] = useState<RiskBoardResponse | null>(null);

  useEffect(() => {
    let alive = true;
    const supabase = createBrowserClient();

    async function run(uid: string) {
      const { data: wl } = await supabase
        .from("user_watchlists")
        .select("drug_id")
        .eq("user_id", uid)
        .eq("is_active", true);
      const ids = [...new Set((wl ?? []).map((r: { drug_id: string }) => r.drug_id).filter(Boolean))];
      if (!alive) return;
      if (ids.length === 0) { setStatus("empty"); return; }

      try {
        const res = await fetch("/api/watchlist/risk-board", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ drug_ids: ids, country: readCountryCookie() }),
        });
        const json = (await res.json()) as RiskBoardResponse;
        if (!alive) return;
        setData(json);
        setStatus("ready");
      } catch {
        if (alive) setStatus("empty");
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!alive) return;
      if (session?.user?.id) run(session.user.id);
      else setStatus("anon");
    });
    return () => { alive = false; };
  }, []);

  // Anonymous or still loading → render nothing (national dashboard shows).
  if (status === "anon" || status === "loading") return null;

  return (
    <div className="rb-wrap">
      <style>{RB_CSS}</style>
      <div className="rb-head">
        <div className="rb-title">Your watchlist — supply risk</div>
        {data && (
          <div className="rb-sum">
            {data.counts.short_now > 0 && <span className="rb-chip rb-crit">{data.counts.short_now} short now</span>}
            {data.counts.anticipated > 0 && <span className="rb-chip rb-warn">{data.counts.anticipated} anticipated</span>}
            {data.counts.early_warning > 0 && <span className="rb-chip rb-info">{data.counts.early_warning} early warning</span>}
            {data.counts.watching > 0 && <span className="rb-chip rb-quiet">{data.counts.watching} in supply</span>}
          </div>
        )}
      </div>

      {status === "empty" ? (
        <div className="rb-empty">
          Nothing on your watchlist yet.{" "}
          <Link href="/search" className="rb-link">Search for a medicine</Link> and tap Watch to track its supply here.
        </div>
      ) : data && data.items.length > 0 ? (
        TIER_ORDER.filter((t) => data.items.some((i) => i.tier === t)).map((tier) => {
          const meta = TIER_META[tier as RiskTier];
          const rows = data.items.filter((i) => i.tier === tier);
          return (
            <div key={tier} className="rb-group">
              <div className="rb-glabel">
                <span className={`rb-dot ${meta.cls}`} />
                {meta.label} <span className="rb-gn">{rows.length}</span>
                <span className="rb-blurb">{meta.blurb}</span>
              </div>
              <div className="rb-rows">
                {rows.map((it) => (
                  <Link key={it.drug_id} href={`/drugs/${it.drug_id}`} className="rb-row">
                    <div className="rb-name">
                      {truncateDrugName(it.name, 40)}
                      {it.who_essential && <span className="rb-who" title="WHO Essential Medicine">WHO EML</span>}
                    </div>
                    <div className="rb-detail">{detailFor(it, data.imminent_window_days)}</div>
                  </Link>
                ))}
              </div>
            </div>
          );
        })
      ) : (
        <div className="rb-empty">No risk signals for your watched medicines right now.</div>
      )}
      <div className="rb-foot">National picture below.</div>
    </div>
  );
}

const RB_CSS = `
.rb-wrap{--crit:#c0392b;--crit-bg:#fdecea;--crit-b:#f5c6c0;--warn:#b8860b;--warn-bg:#fdf6e3;--warn-b:#f0e0b0;
  --info:#2563eb;--info-bg:#eaf1fe;--info-b:#c7d8fb;--quiet:#6a7280;--quiet-bg:#f3f5f7;--quiet-b:#e2e7ec;
  --ink:#0c1118;--text-2:#3b434e;--text-3:#6a7280;--text-4:#98a1ac;--border:#e8ecf0;--bg:#fff;--bg-2:#fafbfc;
  margin:0 0 22px;padding:18px 20px;border:1px solid var(--border);border-radius:16px;background:var(--bg);
  font-family:var(--font-inter),Inter,system-ui,sans-serif}
.rb-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.rb-title{font-size:15px;font-weight:700;color:var(--ink);letter-spacing:-.01em}
.rb-sum{display:flex;gap:6px;flex-wrap:wrap}
.rb-chip{font-size:11px;font-weight:600;padding:3px 9px;border-radius:99px;white-space:nowrap}
.rb-group{margin-top:12px}
.rb-glabel{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:var(--text-2);margin-bottom:7px}
.rb-gn{font-weight:600;color:var(--text-4)}
.rb-blurb{font-weight:400;color:var(--text-4);font-size:11px}
.rb-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.rb-rows{display:flex;flex-direction:column;gap:6px}
.rb-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 13px;border-radius:11px;
  background:var(--bg-2);border:1px solid var(--border);text-decoration:none;transition:border-color .12s}
.rb-row:hover{border-color:var(--info)}
.rb-name{font-size:13.5px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:8px;min-width:0}
.rb-who{font-size:9.5px;font-weight:700;color:var(--quiet);background:var(--quiet-bg);border:1px solid var(--quiet-b);
  padding:1px 6px;border-radius:99px;letter-spacing:.03em}
.rb-detail{font-size:11.5px;color:var(--text-3);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rb-empty{font-size:13px;color:var(--text-3);padding:8px 2px}
.rb-link{color:var(--info);font-weight:600;text-decoration:none}
.rb-link:hover{text-decoration:underline}
.rb-foot{font-size:11px;color:var(--text-4);margin-top:14px;border-top:1px solid var(--border);padding-top:10px}
.rb-crit{color:var(--crit);background:var(--crit-bg);border:1px solid var(--crit-b)}
.rb-warn{color:var(--warn);background:var(--warn-bg);border:1px solid var(--warn-b)}
.rb-info{color:var(--info);background:var(--info-bg);border:1px solid var(--info-b)}
.rb-quiet{color:var(--quiet);background:var(--quiet-bg);border:1px solid var(--quiet-b)}
span.rb-dot.rb-crit{background:var(--crit)}span.rb-dot.rb-warn{background:var(--warn)}
span.rb-dot.rb-info{background:var(--info)}span.rb-dot.rb-quiet{background:var(--quiet)}
@media(max-width:600px){.rb-row{flex-direction:column;align-items:flex-start;gap:3px}.rb-detail{text-align:left}}
`;
