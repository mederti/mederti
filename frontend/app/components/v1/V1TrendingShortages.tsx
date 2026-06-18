"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { truncateDrugName } from "@/lib/utils";

/**
 * Live "Trending shortages · AU · active" row for the landing page.
 *
 * Mirrors the same block on /chat (ConversationalHome) — identical fetch and
 * card shape — but re-skinned with the v1home tokens (ink/green, Geist) so it
 * sits inside the marketing hero rather than the teal chat surface.
 *
 * Fed by /api/shortages (service-role, public) so anonymous visitors see real,
 * current data. The whole section self-hides if the fetch returns nothing —
 * never an empty band on the landing page.
 */

type TrendRow = {
  shortage_id: string;
  drug_id: string;
  generic_name: string;
  severity: string | null;
  reason_category: string | null;
  estimated_resolution_date: string | null;
  country_code: string;
};

const FLAG: Record<string, string> = {
  AU: "🇦🇺", US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦", JP: "🇯🇵", CH: "🇨🇭",
  DE: "🇩🇪", FR: "🇫🇷", ES: "🇪🇸", IT: "🇮🇹", NL: "🇳🇱", BE: "🇧🇪",
  FI: "🇫🇮", NZ: "🇳🇿", NO: "🇳🇴", IE: "🇮🇪",
};

// Severity → pill style + honest label (real severity, not a softened word).
const SEV: Record<string, { cls: string; label: string }> = {
  critical: { cls: "crit", label: "Critical" },
  high: { cls: "high", label: "High" },
  medium: { cls: "med", label: "Medium" },
  low: { cls: "low", label: "Low" },
};

function monthYear(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("en-AU", { month: "short", year: "2-digit" });
}

function prettyReason(r?: string | null): string | null {
  if (!r) return null;
  return r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function V1TrendingShortages() {
  const [trending, setTrending] = useState<TrendRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/shortages?country=AU&status=active&sort=severity&page_size=4")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const rows = (data.results ?? []) as TrendRow[];
        setTrending(rows.filter((r) => r.generic_name && r.drug_id));
        setTotal(typeof data.total === "number" ? data.total : null);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // Loaded with nothing → render nothing (no empty band on a marketing page).
  if (loaded && trending.length === 0) return null;

  return (
    <section className="ts">
      <style>{CSS}</style>
      <div className="ts-head">
        <div className="ts-label">Trending shortages · AU · active</div>
        <Link href="/shortages" className="ts-link">
          {total != null ? `See all ${total.toLocaleString()} active →` : "See all →"}
        </Link>
      </div>
      <div className="ts-grid">
        {!loaded
          ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="ts-card ts-skel" />)
          : trending.map((t) => {
              const sev = SEV[(t.severity ?? "").toLowerCase()] ?? { cls: "med", label: t.severity ?? "Active" };
              const back = monthYear(t.estimated_resolution_date);
              const reason = prettyReason(t.reason_category);
              return (
                <Link key={t.shortage_id} href={`/drugs/${t.drug_id}`} className="ts-card">
                  <div className="ts-card-head">
                    <span className="ts-flag">{FLAG[t.country_code] ?? "🏳️"}</span>
                    <span className={`ts-pill ${sev.cls}`}>
                      <span className="ts-dot" />{sev.label}
                    </span>
                  </div>
                  <div className="ts-name">{truncateDrugName(t.generic_name, 32)}</div>
                  <div className="ts-meta">{reason ?? "Cause under review"}</div>
                  <div className="ts-stat">
                    <span>Back by</span>
                    <span className="ts-val">{back ?? "No estimate"}</span>
                  </div>
                </Link>
              );
            })}
      </div>
    </section>
  );
}

const CSS = `
.ts{--crit:#dc2647;--crit-bg:#fdeef1;--crit-b:#f8cdd6;
  --high:#c2410c;--high-bg:#fff3ec;--high-b:#fad4bf;
  --med:#b46708;--med-bg:#fdf6e9;--med-b:#f3dcae;
  --low:#0c8a62;--low-bg:#e8f6f0;--low-b:#bce4d4;
  max-width:920px;margin:clamp(40px,5vw,64px) auto 0;padding:0 clamp(20px,4vw,40px);position:relative;z-index:1}
.ts-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding:0 2px}
.ts-label{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-4)}
.ts-link{font-size:12.5px;color:var(--text-3);text-decoration:none;white-space:nowrap;transition:color .15s}
.ts-link:hover{color:var(--green-d)}
.ts-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.ts-card{display:block;background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:15px;text-decoration:none;color:inherit;transition:.16s}
.ts-card:hover{border-color:var(--border-2);transform:translateY(-2px);box-shadow:0 12px 28px -12px rgba(12,17,24,.18)}
.ts-card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.ts-flag{font-size:15px;line-height:1}
.ts-pill{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:600;padding:3px 9px;border-radius:7px}
.ts-pill.crit{background:var(--crit-bg);color:var(--crit);border:1px solid var(--crit-b)}
.ts-pill.high{background:var(--high-bg);color:var(--high);border:1px solid var(--high-b)}
.ts-pill.med{background:var(--med-bg);color:var(--med);border:1px solid var(--med-b)}
.ts-pill.low{background:var(--low-bg);color:var(--low);border:1px solid var(--low-b)}
.ts-dot{width:5px;height:5px;border-radius:50%;background:currentColor}
.ts-name{font-size:15px;font-weight:600;letter-spacing:-.02em;line-height:1.3;margin-bottom:5px;color:var(--ink)}
.ts-meta{font-size:11.5px;color:var(--text-4);margin-bottom:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ts-stat{display:flex;align-items:center;justify-content:space-between;padding-top:10px;border-top:1px solid var(--border);font-size:11.5px;color:var(--text-3)}
.ts-val{font-weight:600;color:var(--ink)}
.ts-skel{height:130px;border:1px solid var(--border);background:linear-gradient(100deg,var(--bg-3) 28%,var(--bg-2) 50%,var(--bg-3) 72%);background-size:200% 100%;animation:ts-sh 1.3s linear infinite}
@keyframes ts-sh{from{background-position:200% 0}to{background-position:-200% 0}}
@media(max-width:900px){.ts-grid{grid-template-columns:1fr 1fr}}
@media(max-width:600px){.ts-grid{grid-template-columns:1fr}}
`;
