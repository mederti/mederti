"use client";

import { useEffect, useState } from "react";

/**
 * Parallel Trade Intelligence panel for the V1 drug page.
 *
 * Fetches /api/drugs/[id]/parallel-trade and renders EMA parallel-distribution
 * notices + national parallel-import licences matched to this molecule, each
 * with a confidence badge and source link. Low-confidence (needs_review)
 * matches are shown in a demoted "under review" block with a warning, never as
 * confirmed routes — matching the honesty bar of the rest of the page.
 *
 * Renders nothing until the API confirms the feature is available (migration
 * 060 applied) so it never errors a drug page where the tables don't exist yet.
 */

const FLAG: Record<string, string> = {
  AU: "🇦🇺", NZ: "🇳🇿", GB: "🇬🇧", US: "🇺🇸", CA: "🇨🇦", EU: "🇪🇺", IE: "🇮🇪",
  DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", ES: "🇪🇸", NL: "🇳🇱", BE: "🇧🇪", SE: "🇸🇪",
  DK: "🇩🇰", FI: "🇫🇮", NO: "🇳🇴", CH: "🇨🇭", AT: "🇦🇹", PL: "🇵🇱", PT: "🇵🇹",
  GR: "🇬🇷", CZ: "🇨🇿", HU: "🇭🇺", RO: "🇷🇴", BG: "🇧🇬", SK: "🇸🇰", SI: "🇸🇮",
  HR: "🇭🇷", LT: "🇱🇹", LV: "🇱🇻", EE: "🇪🇪", LU: "🇱🇺", CY: "🇨🇾", MT: "🇲🇹",
  IS: "🇮🇸", LI: "🇱🇮",
};
const flag = (c: string | null) => (c ? FLAG[c.toUpperCase()] ?? "🌐" : "🌐");

interface Licence {
  licence_id: string;
  licence_type: "EMA_PARALLEL_DISTRIBUTION" | "NATIONAL_PARALLEL_IMPORT";
  licence_number: string | null;
  status: string;
  product_name: string;
  pack_size: string | null;
  licence_holder: string | null;
  marketing_authorisation_holder: string | null;
  source_country: string | null;
  destination_country: string | null;
  destination_country_name: string | null;
  reference_product_name: string | null;
  source_authority: string | null;
  source_url: string | null;
  last_checked: string | null;
  confidence: number;
  match_basis: string[];
}

interface Payload {
  available: boolean;
  ema_distribution: Licence[];
  national_imports: Licence[];
  review: Licence[];
  summary: { ema_count: number; national_count: number; countries: number; needs_review: number };
}

function confClass(c: number) {
  if (c >= 0.9) return "pt-conf-ok";
  if (c >= 0.65) return "pt-conf-ok";
  return "pt-conf-low";
}
function fmtDate(iso: string | null) {
  if (!iso) return "recently";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "recently";
  }
}

function LicenceRow({ l, review }: { l: Licence; review?: boolean }) {
  const title =
    l.licence_type === "EMA_PARALLEL_DISTRIBUTION"
      ? "EU/EEA · parallel distribution between member states"
      : `${flag(l.destination_country)} ${l.destination_country_name ?? l.destination_country ?? ""} · ${l.source_authority ?? ""}`;
  const route =
    l.source_country || l.destination_country
      ? `${flag(l.source_country)} ${l.source_country ?? "—"} → ${flag(l.destination_country)} ${l.destination_country ?? "—"}`
      : null;
  return (
    <div className={`pt-row${review ? " pt-row-review" : ""}`}>
      <div className="pt-row-head">
        <div className="pt-row-titles">
          <div className="pt-row-title">
            {review && <span className="pt-warn-ic" aria-hidden>⚠</span>}
            {title}
          </div>
          <div className="pt-row-sub">
            {l.licence_holder && (
              <>
                Distributor / holder <b>{l.licence_holder}</b>
              </>
            )}
            {l.marketing_authorisation_holder && <> · MAH {l.marketing_authorisation_holder}</>}
            {l.reference_product_name && <> · ref. {l.reference_product_name}</>}
            {review && <> · low-confidence (INN-only) match</>}
          </div>
        </div>
        <span className={`pt-pill ${review ? "pt-pill-med" : "pt-pill-ok"}`}>
          {review ? "Needs review" : l.status.charAt(0).toUpperCase() + l.status.slice(1)}
        </span>
      </div>
      <div className="pt-row-meta">
        {l.licence_number && (
          <span>
            <span className="pt-k">{l.licence_type === "EMA_PARALLEL_DISTRIBUTION" ? "Notice" : "Licence"}</span> {l.licence_number}
          </span>
        )}
        <span>
          <span className="pt-k">Pack</span> {l.pack_size ?? "—"}
        </span>
        {route && (
          <span>
            <span className="pt-k">Route</span> {route}
          </span>
        )}
        <span className="pt-conf">
          <span className="pt-k">Match</span>
          <span className={`pt-conf-badge ${confClass(l.confidence)}`}>{l.confidence.toFixed(2)}</span>
        </span>
      </div>
      {review ? (
        <div className="pt-review-note">
          ⓘ Low-confidence match (INN only). Surfaced for curation — confirm before relying on it.
        </div>
      ) : (
        <div className="pt-row-foot">
          {l.source_url ? (
            <a href={l.source_url} target="_blank" rel="noopener noreferrer" className="pt-src">
              {l.source_authority ?? "Source"} ↗
            </a>
          ) : (
            <span />
          )}
          <span className="pt-checked">checked {fmtDate(l.last_checked)}</span>
        </div>
      )}
    </div>
  );
}

export function ParallelTradePanel({ drugId }: { drugId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/drugs/${drugId}/parallel-trade`);
        const json = (await res.json()) as Payload;
        if (!cancelled) setData(json);
      } catch {
        /* silent — panel just won't render */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [drugId]);

  // Don't render until the feature is confirmed available (tables exist).
  if (!loaded || !data || !data.available) return null;

  const { ema_distribution, national_imports, review, summary } = data;
  const hasAny = summary.ema_count + summary.national_count + summary.needs_review > 0;

  // Group national imports by destination country.
  const byCountry = new Map<string, Licence[]>();
  for (const l of national_imports) {
    const k = l.destination_country ?? "??";
    if (!byCountry.has(k)) byCountry.set(k, []);
    byCountry.get(k)!.push(l);
  }

  return (
    <div className="sec" id="parallel-trade">
      <style>{PT_CSS}</style>
      <div className="sec-title">
        Parallel trade intelligence <span className="help">cross-border import licences &amp; EMA distribution notices</span>
      </div>

      {!hasAny ? (
        <div className="pt-empty">No parallel-import licences or EMA distribution notices matched this product yet.</div>
      ) : (
        <>
          <div className="pt-chips">
            {summary.ema_count > 0 && <span className="pt-pill pt-pill-ok">● {summary.ema_count} EMA notice{summary.ema_count !== 1 ? "s" : ""}</span>}
            {summary.national_count > 0 && (
              <span className="pt-pill pt-pill-ok">
                ● {summary.national_count} national licence{summary.national_count !== 1 ? "s" : ""} · {summary.countries} countr{summary.countries !== 1 ? "ies" : "y"}
              </span>
            )}
            {summary.needs_review > 0 && <span className="pt-pill pt-pill-med">⚠ {summary.needs_review} need{summary.needs_review !== 1 ? "" : "s"} review</span>}
          </div>

          {ema_distribution.length > 0 && (
            <>
              <div className="pt-group">EMA parallel distribution</div>
              {ema_distribution.map((l) => (
                <LicenceRow key={l.licence_id} l={l} />
              ))}
            </>
          )}

          {national_imports.length > 0 && (
            <>
              <div className="pt-group">National parallel import licences</div>
              {national_imports.map((l) => (
                <LicenceRow key={l.licence_id} l={l} />
              ))}
            </>
          )}

          {review.length > 0 && (
            <>
              <div className="pt-group">Under review</div>
              {review.map((l) => (
                <LicenceRow key={l.licence_id} l={l} review />
              ))}
            </>
          )}

          <div className="pt-foot">
            Matched by INN + strength + form. Confidence reflects how much of brand / strength / form / pack / MA number we could corroborate.
          </div>
        </>
      )}
    </div>
  );
}

const PT_CSS = `
#parallel-trade .pt-chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
#parallel-trade .pt-group{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-4);margin:18px 0 10px}
#parallel-trade .pt-group:first-of-type{margin-top:0}
#parallel-trade .pt-row{border:1px solid var(--border);border-radius:12px;background:var(--bg-2);padding:14px 16px;margin-bottom:10px;box-shadow:var(--sh-card),var(--hi-inset)}
#parallel-trade .pt-row-review{border-color:var(--med-b);background:var(--med-bg)}
#parallel-trade .pt-row-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
#parallel-trade .pt-row-titles{min-width:0}
#parallel-trade .pt-row-title{font-size:13.5px;font-weight:600;letter-spacing:-.01em;color:var(--ink);display:flex;align-items:center;gap:6px}
#parallel-trade .pt-warn-ic{color:var(--med)}
#parallel-trade .pt-row-sub{font-size:12px;color:var(--text-3);margin-top:3px;line-height:1.5}
#parallel-trade .pt-row-sub b{font-weight:600}
#parallel-trade .pt-row-meta{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:11px;font-size:11.5px;color:var(--text-2)}
#parallel-trade .pt-k{color:var(--text-4)}
#parallel-trade .pt-conf{display:inline-flex;align-items:center;gap:5px}
#parallel-trade .pt-conf-badge{font-weight:600;padding:1px 7px;border-radius:99px;border:1px solid var(--ok-b)}
#parallel-trade .pt-conf-ok{color:var(--green-d);background:var(--ok-bg)}
#parallel-trade .pt-conf-low{color:var(--med);background:#fff;border-color:var(--med-b)}
#parallel-trade .pt-row-foot{display:flex;justify-content:space-between;align-items:center;margin-top:11px;padding-top:10px;border-top:1px solid var(--border)}
#parallel-trade .pt-src{font-size:11.5px;color:var(--green-d);text-decoration:none}
#parallel-trade .pt-src:hover{text-decoration:underline}
#parallel-trade .pt-checked{font-size:11px;color:var(--text-4);font-family:var(--font-geist-mono),ui-monospace,monospace}
#parallel-trade .pt-review-note{font-size:11.5px;color:var(--med);margin-top:10px;padding-top:10px;border-top:1px solid var(--med-b);line-height:1.5}
#parallel-trade .pt-pill{font-size:11px;font-weight:600;padding:3px 9px;border-radius:99px;white-space:nowrap}
#parallel-trade .pt-pill-ok{color:var(--green-d);background:var(--ok-bg);border:1px solid var(--ok-b)}
#parallel-trade .pt-pill-med{color:var(--med);background:var(--med-bg);border:1px solid var(--med-b)}
#parallel-trade .pt-empty{font-size:12.5px;color:var(--text-3)}
#parallel-trade .pt-foot{font-size:11px;color:var(--text-4);margin-top:14px;line-height:1.5}
`;
