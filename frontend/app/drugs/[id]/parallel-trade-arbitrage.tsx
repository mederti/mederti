"use client";

import { useEffect, useState } from "react";

/**
 * VIEW B — "Price-spread opportunities" (importer / parallel-trade desk).
 * Fuses the EU27 pricing layer with parallel-trade licences into a buy-low /
 * sell-high map, normalised to €/unit at indicative FX and compared on a single
 * shared price type. Renders only when a real (comparable) spread exists.
 * See /api/drugs/[id]/parallel-trade/arbitrage.
 */

const FLAG: Record<string, string> = {
  GB: "🇬🇧", IE: "🇮🇪", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", ES: "🇪🇸", NL: "🇳🇱",
  BE: "🇧🇪", SE: "🇸🇪", DK: "🇩🇰", FI: "🇫🇮", NO: "🇳🇴", CH: "🇨🇭", AT: "🇦🇹",
  PL: "🇵🇱", PT: "🇵🇹", GR: "🇬🇷", CZ: "🇨🇿", HU: "🇭🇺", RO: "🇷🇴", BG: "🇧🇬",
  SK: "🇸🇰", SI: "🇸🇮", HR: "🇭🇷", LT: "🇱🇹", LV: "🇱🇻", EE: "🇪🇪", LU: "🇱🇺",
  CY: "🇨🇾", MT: "🇲🇹", IS: "🇮🇸", LI: "🇱🇮", US: "🇺🇸",
};
const flag = (c: string | null) => (c ? FLAG[c.toUpperCase()] ?? "🌐" : "🌐");
const eur = (v: number | null) => (v == null ? "—" : `€${v < 1 ? v.toFixed(3) : v.toFixed(2)}`);

interface Route {
  source_country: string;
  source_country_name: string;
  buy_eur_unit: number;
  sell_eur_unit: number;
  spread_abs: number;
  spread_pct: number | null;
  licensed_lanes: number;
  crowding: "open" | "active" | "saturated";
}
interface Payload {
  available: boolean;
  destination: string;
  destination_name: string;
  price_type?: string;
  fx_as_of?: string;
  sell_eur_unit?: number;
  priced_markets?: number;
  comparable_markets?: number;
  excluded_markets?: number;
  best_spread_pct: number | null;
  routes: Route[];
  caveat?: string;
  note?: string;
}

const CROWD: Record<string, string> = { open: "0 licensed — open", active: "licensed — active", saturated: "licensed — saturated" };

export function ParallelTradeArbitrage({ drugId, destination }: { drugId: string; destination: string }) {
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/drugs/${drugId}/parallel-trade/arbitrage?destination=${encodeURIComponent(destination)}`);
        const json = (await res.json()) as Payload;
        if (!cancelled) setData(json);
      } catch {
        /* silent */
      }
    })();
    return () => { cancelled = true; };
  }, [drugId, destination]);

  // Only surface when at least one route has a real, comparable spread.
  const hasRealSpread = !!data && data.routes.some((r) => r.spread_pct != null);
  if (!data || !data.available || !hasRealSpread) return null;

  return (
    <div className="sec" id="pt-arb">
      <style>{CSS}</style>
      <div className="sec-title">
        Parallel-trade arbitrage map <span className="help">€/unit vs {flag(data.destination)} {data.destination_name} · {data.price_type?.replace(/_/g, " ")}</span>
      </div>
      <div className="pta-tools">
        {data.best_spread_pct != null && data.best_spread_pct > 0 && (
          <span className="pta-pill">Best spread +{data.best_spread_pct}%</span>
        )}
        <span className="pta-seg">
          {data.comparable_markets ?? data.routes.length + 1} comparable markets
          {data.excluded_markets ? ` · ${data.excluded_markets} excluded (different price basis)` : ""}
        </span>
      </div>

      <div className="pta-scroll">
        <table className="pta">
          <thead>
            <tr>
              <th>Route</th>
              <th className="num">Buy €/unit</th>
              <th className="num">Sell €/unit</th>
              <th className="num">Gross spread</th>
              <th className="hide">Lane crowding</th>
            </tr>
          </thead>
          <tbody>
            {data.routes.map((r, i) => {
              const positive = r.spread_pct != null && r.spread_pct > 0;
              return (
                <tr key={r.source_country} className={i === 0 && positive ? "top" : ""}>
                  <td className="route">
                    {flag(r.source_country)} {r.source_country} <span className="arr">→</span> {flag(data.destination)} {data.destination}
                  </td>
                  <td className="price">{eur(r.buy_eur_unit)}</td>
                  <td className="price">{eur(r.sell_eur_unit)}</td>
                  <td className={`spread ${positive ? "big" : ""}`}>
                    {r.spread_pct == null ? "—" : <>{r.spread_abs >= 0 ? "+" : ""}{eur(r.spread_abs)} · {r.spread_pct}%</>}
                  </td>
                  <td className="hide">
                    <span className="lc">
                      <span className={`lcd ${r.crowding}`} />
                      {r.crowding === "open" ? CROWD.open : `${r.licensed_lanes} ${CROWD[r.crowding]}`}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data.caveat && <div className="pta-caveat">⚠ {data.caveat}</div>}
      <div className="pta-note">
        Source: Mederti EU27 pricing layer · normalised to €/unit at indicative FX ({data.fx_as_of}). Lane crowding: active parallel-trade licences on the route.
      </div>
    </div>
  );
}

const CSS = `
#pt-arb .pta-tools{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
#pt-arb .pta-pill{font-size:11px;font-weight:600;padding:4px 10px;border-radius:99px;color:var(--green-d);background:var(--ok-bg);border:1px solid var(--ok-b)}
#pt-arb .pta-seg{font-size:11.5px;color:var(--text-3)}
#pt-arb .pta-scroll{overflow-x:auto}
#pt-arb table.pta{width:100%;border-collapse:collapse;font-size:12.5px}
#pt-arb table.pta thead th{text-align:left;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-4);padding:0 10px 9px;border-bottom:1px solid var(--border);white-space:nowrap}
#pt-arb table.pta thead th.num{text-align:right}
#pt-arb table.pta tbody td{padding:12px 10px;border-bottom:1px solid var(--border);vertical-align:middle}
#pt-arb table.pta tbody tr:last-child td{border-bottom:none}
#pt-arb table.pta tbody tr.top{background:var(--ok-bg)}
#pt-arb .route{font-weight:600;color:var(--ink);white-space:nowrap}
#pt-arb .route .arr{color:var(--text-4);font-weight:400;margin:0 4px}
#pt-arb .price{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;color:var(--text-2)}
#pt-arb .spread{font-weight:700;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--text-3)}
#pt-arb .spread.big{color:var(--green-d)}
#pt-arb .lc{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-2);white-space:nowrap}
#pt-arb .lcd{width:7px;height:7px;border-radius:50%}
#pt-arb .lcd.open{background:var(--green)}
#pt-arb .lcd.active{background:var(--med)}
#pt-arb .lcd.saturated{background:var(--crit)}
#pt-arb .pta-caveat{margin-top:16px;background:var(--med-bg);border:1px solid var(--med-b);border-radius:10px;padding:11px 14px;font-size:11.5px;color:var(--med);line-height:1.55}
#pt-arb .pta-note{font-size:11px;color:var(--text-4);margin-top:12px;line-height:1.5}
@media(max-width:680px){#pt-arb table.pta .hide{display:none}}
`;
