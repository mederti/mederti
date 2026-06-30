"use client";

import { useEffect, useState } from "react";

/**
 * VIEW A — "Sourcing routes during a shortage" (procurement / hospital
 * pharmacist). Renders ONLY when the drug is in shortage in the user's market
 * and there are parallel-import lanes that can supply it — otherwise the raw
 * licence panel covers the reference case. Fuses parallel_trade_licences with
 * the shortage layer (see /api/drugs/[id]/parallel-trade/sourcing).
 */

const FLAG: Record<string, string> = {
  GB: "🇬🇧", IE: "🇮🇪", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", ES: "🇪🇸", NL: "🇳🇱",
  BE: "🇧🇪", SE: "🇸🇪", DK: "🇩🇰", FI: "🇫🇮", NO: "🇳🇴", CH: "🇨🇭", AT: "🇦🇹",
  PL: "🇵🇱", PT: "🇵🇹", GR: "🇬🇷", CZ: "🇨🇿", HU: "🇭🇺", RO: "🇷🇴", BG: "🇧🇬",
  SK: "🇸🇰", SI: "🇸🇮", HR: "🇭🇷", LT: "🇱🇹", LV: "🇱🇻", EE: "🇪🇪", LU: "🇱🇺",
  CY: "🇨🇾", MT: "🇲🇹", IS: "🇮🇸", LI: "🇱🇮", EU: "🇪🇺",
};
const flag = (c: string | null) => (c ? FLAG[c.toUpperCase()] ?? "🌐" : "🌐");

interface Lane {
  licence_id: string;
  licence_type: string;
  licence_number: string | null;
  pack_size: string | null;
  strength: string | null;
  dosage_form: string | null;
  licence_holder: string | null;
  reference_product_name: string | null;
  source_country: string | null;
  source_country_name: string | null;
  destination_country: string | null;
  source_authority: string | null;
  source_url: string | null;
  last_checked: string | null;
  confidence: number;
  source_in_shortage: boolean;
  viable: boolean;
}
interface Payload {
  available: boolean;
  destination_in_shortage: boolean;
  market: string;
  market_name: string;
  viable_count: number;
  lanes: Lane[];
}

function fmtDate(iso: string | null) {
  if (!iso) return "recently";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "recently";
  }
}

export function ParallelTradeSourcing({
  drugId,
  userCountry,
}: {
  drugId: string;
  userCountry: string;
}) {
  const [data, setData] = useState<Payload | null>(null);

  // Reuse the existing "Find a supplier" drawer (rendered by FindSupplier on the
  // same page) rather than duplicating the enquiry flow.
  const requestSourcing = () => {
    const btn = document.querySelector<HTMLButtonElement>(".find-supplier-btn");
    if (btn) btn.click();
    else document.getElementById("pt-sourcing")?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/drugs/${drugId}/parallel-trade/sourcing?market=${encodeURIComponent(userCountry)}`);
        const json = (await res.json()) as Payload;
        if (!cancelled) setData(json);
      } catch {
        /* silent */
      }
    })();
    return () => { cancelled = true; };
  }, [drugId, userCountry]);

  // Only valuable when the product is short HERE and there are lanes to show.
  if (!data || !data.available || !data.destination_in_shortage || data.lanes.length === 0) {
    return null;
  }

  return (
    <div className="sec" id="pt-sourcing">
      <style>{CSS}</style>
      <div className="sec-title">
        Cross-border sourcing routes <span className="help">parallel-import lanes that can supply {flag(data.market)} {data.market_name} during this shortage</span>
      </div>
      <div className="pts-lead">
        {data.viable_count > 0 ? (
          <>
            <b>{data.viable_count}</b> active import lane{data.viable_count !== 1 ? "s" : ""} can supply {data.market_name} from market{data.viable_count !== 1 ? "s" : ""} not currently short. Mederti can request a quote from the licensed importer on your behalf.
          </>
        ) : (
          <>Parallel-import lanes exist, but their source markets are also in shortage right now — none are currently viable.</>
        )}
      </div>

      {data.lanes.map((l) => (
        <div className={`pts-lane${l.viable ? "" : " pts-lane-blocked"}`} key={l.licence_id}>
          <div className="pts-head">
            <div>
              <div className="pts-route">
                {flag(l.source_country)} {l.source_country_name ?? l.source_country} <span className="pts-arrow">→</span> {flag(l.destination_country)} {data.market_name}
              </div>
              <div className="pts-sub">
                via <b>{l.licence_holder ?? "licensed importer"}</b>
                {l.licence_number && <> · {l.licence_number}</>}
                {l.reference_product_name && <> · ref. {l.reference_product_name}</>}
              </div>
            </div>
            <span className={`pts-pill ${l.viable ? "pts-pill-ok" : "pts-pill-crit"}`}>
              <span className="pts-dot" />
              {l.viable ? "In supply at source" : "Source also short"}
            </span>
          </div>
          <div className="pts-meta">
            <span><span className="k">Pack</span> {l.pack_size ?? "—"}</span>
            {l.strength && <span><span className="k">Strength</span> {l.strength}</span>}
            <span><span className="k">Source status</span> {l.source_in_shortage ? `${l.source_country} shortage notice active` : `No ${l.source_country} shortage notice`}</span>
            <span className="pts-conf"><span className="k">Match</span> <span className="pts-cb">{l.confidence.toFixed(2)}</span></span>
          </div>
          <div className="pts-foot">
            {l.source_url ? (
              <a href={l.source_url} target="_blank" rel="noopener noreferrer" className="pts-src">{l.source_authority ?? "Source"} ↗</a>
            ) : <span className="pts-checked">checked {fmtDate(l.last_checked)}</span>}
            <button type="button" className="pts-req" disabled={!l.viable} onClick={requestSourcing}>
              Request via Mederti
            </button>
          </div>
        </div>
      ))}

      <div className="pts-note">Lanes shown only where the source market has no active shortage notice (so the route is viable). Source: parallel-import registers ⋈ Mederti shortage layer.</div>
    </div>
  );
}

const CSS = `
#pt-sourcing .pts-lead{font-size:12.5px;color:var(--text-3);margin-bottom:16px;line-height:1.55}
#pt-sourcing .pts-lead b{color:var(--ink);font-weight:700}
#pt-sourcing .pts-lane{border:1px solid var(--border);border-radius:12px;background:var(--bg-2);padding:14px 16px;margin-bottom:10px;box-shadow:var(--sh-card),var(--hi-inset)}
#pt-sourcing .pts-lane-blocked{opacity:.62}
#pt-sourcing .pts-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
#pt-sourcing .pts-route{font-size:14px;font-weight:600;letter-spacing:-.01em;color:var(--ink);display:flex;align-items:center;gap:8px}
#pt-sourcing .pts-arrow{color:var(--text-4);font-weight:400}
#pt-sourcing .pts-sub{font-size:12px;color:var(--text-3);margin-top:3px;line-height:1.5}
#pt-sourcing .pts-sub b{font-weight:600;color:var(--text-2)}
#pt-sourcing .pts-meta{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:11px;font-size:11.5px;color:var(--text-2)}
#pt-sourcing .k{color:var(--text-4)}
#pt-sourcing .pts-conf{display:inline-flex;align-items:center;gap:5px}
#pt-sourcing .pts-cb{font-weight:600;padding:1px 7px;border-radius:99px;border:1px solid var(--ok-b);color:var(--green-d);background:var(--ok-bg)}
#pt-sourcing .pts-foot{display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:11px;border-top:1px solid var(--border)}
#pt-sourcing .pts-src{font-size:11.5px;color:var(--green-d);text-decoration:none}
#pt-sourcing .pts-src:hover{text-decoration:underline}
#pt-sourcing .pts-checked{font-size:11px;color:var(--text-4);font-family:var(--font-geist-mono),ui-monospace,monospace}
#pt-sourcing .pts-req{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:9px;font-size:12px;font-weight:600;border:1px solid var(--green);background:var(--green);color:#fff;cursor:pointer;font-family:inherit;transition:filter .15s}
#pt-sourcing .pts-req:hover:not(:disabled){filter:brightness(1.05)}
#pt-sourcing .pts-req:disabled{opacity:.4;cursor:not-allowed;background:var(--bg);color:var(--text-4)}
#pt-sourcing .pts-pill{font-size:11px;font-weight:600;padding:4px 10px;border-radius:99px;white-space:nowrap;display:inline-flex;align-items:center;gap:5px}
#pt-sourcing .pts-dot{width:7px;height:7px;border-radius:50%;background:currentColor}
#pt-sourcing .pts-pill-ok{color:var(--green-d);background:var(--ok-bg);border:1px solid var(--ok-b)}
#pt-sourcing .pts-pill-crit{color:var(--crit);background:var(--crit-bg);border:1px solid var(--crit-b)}
#pt-sourcing .pts-note{font-size:11px;color:var(--text-4);margin-top:14px;line-height:1.5}
`;
