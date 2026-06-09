"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { truncateDrugName } from "@/lib/utils";

/**
 * Conversational "Ask" home — ported from the chat-first v1 mockup (Mockup G).
 *
 * One shared surface used in two places:
 *   • /ask        — the logged-in home landing (full hero ask box on top)
 *   • /chat       — the empty-state of the chat middle column (ask box hidden,
 *                   because the chat composer already lives at the bottom)
 *
 * Content: a hero ask box + market/scope pills, a grid of suggested prompts,
 * and a live "Trending shortages · last 24h" row fed by /api/shortages.
 *
 * All asks (typed question OR a clicked prompt) flow through `onAsk` so each
 * host decides where they go (route into /chat, or send inline).
 */

// Suggested prompts — the exact set from the mockup. Each fires verbatim into
// `onAsk`. Kept as a module constant so both hosts share the same wording.
export const HOME_PROMPTS: string[] = [
  "What antibiotics are short in AU right now?",
  "Substitute for amoxicillin 500mg in adult sinusitis",
  "Which GLP-1s have stock in pharmacies this week?",
  "Compare insulin trade prices · AU vs UK vs US",
  "What's likely to be short in Q3 from India API issues?",
  "Show me all paediatric formulations in shortage",
];

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

// Severity → pill style + honest label (we show the real severity, not a
// softened marketing word).
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

export default function ConversationalHome({
  onAsk,
  showHeroAsk = true,
}: {
  onAsk: (question: string) => void;
  showHeroAsk?: boolean;
}) {
  const [draft, setDraft] = useState("");
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

  const submit = () => {
    const q = draft.trim();
    if (q) onAsk(q);
  };

  return (
    <div className="chome">
      <style>{CSS}</style>

      {showHeroAsk && (
        <div className="chome-ask">
          <input
            className="chome-ask-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="What's in shortage? What can I substitute? What's likely to be short next quarter?"
          />
          <div className="chome-ask-tools">
            <div className="chome-pills">
              <span className="chome-pill">📍 AU</span>
              <span className="chome-pill">💊 All drugs</span>
              <span className="chome-pill">📅 Live</span>
            </div>
            <button
              type="button"
              className="chome-send"
              onClick={submit}
              disabled={!draft.trim()}
              aria-label="Ask"
            >
              ↑
            </button>
          </div>
        </div>
      )}

      <div className="chome-prompts">
        {HOME_PROMPTS.map((p) => (
          <button key={p} type="button" className="chome-prompt" onClick={() => onAsk(p)}>
            <span className="chome-prompt-ic">→</span>
            {p}
          </button>
        ))}
      </div>

      {(trending.length > 0 || !loaded) && (
        <div className="chome-trending">
          <div className="chome-trending-head">
            <div className="chome-trending-label">Trending shortages · AU · active</div>
            <Link href="/shortages" className="chome-trending-link">
              {total != null ? `See all ${total.toLocaleString()} active →` : "See all →"}
            </Link>
          </div>
          <div className="chome-trending-grid">
            {trending.map((t) => {
              const sev = SEV[(t.severity ?? "").toLowerCase()] ?? { cls: "med", label: t.severity ?? "Active" };
              const back = monthYear(t.estimated_resolution_date);
              const reason = prettyReason(t.reason_category);
              return (
                <Link key={t.shortage_id} href={`/drugs/${t.drug_id}`} className="chome-card">
                  <div className="chome-card-head">
                    <span className="chome-card-flag">{FLAG[t.country_code] ?? "🏳️"}</span>
                    <span className={`chome-card-pill ${sev.cls}`}>
                      <span className="chome-card-dot" />{sev.label}
                    </span>
                  </div>
                  <div className="chome-card-name">{truncateDrugName(t.generic_name, 32)}</div>
                  <div className="chome-card-meta">{reason ?? "Cause under review"}</div>
                  <div className="chome-card-stat">
                    <span>Back by</span>
                    <span className="chome-card-val">{back ?? "No estimate"}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const CSS = `
.chome{--ch-teal:#0fa676;--ch-teal-d:#0c8a62;--ch-teal-bg:#e8f6f0;--ch-teal-b:#bce4d4;
  --ch-bg:#fff;--ch-bg-2:#fafbfc;--ch-border:#e8ecf0;--ch-border-2:#dde3e9;
  --ch-text:#0c1118;--ch-text-3:#6a7280;--ch-text-4:#98a1ac;
  --ch-crit:#dc2647;--ch-crit-bg:#fdeef1;--ch-crit-b:#f8cdd6;
  --ch-high:#c2410c;--ch-high-bg:#fff3ec;--ch-high-b:#fad4bf;
  --ch-med:#b46708;--ch-med-bg:#fdf6e9;--ch-med-b:#f3dcae;
  --ch-low:#0c8a62;--ch-low-bg:#e8f6f0;--ch-low-b:#bce4d4;
  font-family:var(--font-geist-sans),system-ui,sans-serif;color:var(--ch-text);width:100%}
.chome *{box-sizing:border-box}

/* ── Hero ask box ── */
.chome-ask{background:var(--ch-bg);border:1.5px solid var(--ch-border-2);border-radius:16px;
  padding:16px 18px 13px;box-shadow:0 12px 36px -18px rgba(10,15,26,.22);transition:.15s}
.chome-ask:focus-within{border-color:var(--ch-teal);box-shadow:0 14px 40px -16px rgba(16,166,118,.4)}
.chome-ask-input{width:100%;border:0;outline:0;background:transparent;font-family:inherit;
  font-size:16px;color:var(--ch-text);padding:4px 0 2px}
.chome-ask-input::placeholder{color:var(--ch-text-4)}
.chome-ask-tools{display:flex;align-items:center;justify-content:space-between;
  margin-top:8px;padding-top:10px;border-top:1px dashed var(--ch-border)}
.chome-pills{display:flex;gap:6px;flex-wrap:wrap}
.chome-pill{font-size:11.5px;color:var(--ch-text-3);padding:5px 10px;border:1px solid var(--ch-border);
  border-radius:7px;background:var(--ch-bg-2)}
.chome-send{width:34px;height:34px;border-radius:9px;background:var(--ch-teal);border:0;color:#fff;
  font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.14s}
.chome-send:hover:not(:disabled){background:var(--ch-teal-d)}
.chome-send:disabled{opacity:.45;cursor:not-allowed}

/* ── Suggested prompts ── */
.chome-prompts{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:22px}
.chome-prompt{display:flex;align-items:flex-start;gap:9px;text-align:left;line-height:1.45;
  background:var(--ch-bg);border:1px solid var(--ch-border);border-radius:11px;padding:13px 15px;
  font-family:inherit;font-size:13px;color:var(--ch-text);cursor:pointer;transition:.15s}
.chome-prompt:hover{border-color:var(--ch-teal);background:var(--ch-teal-bg);color:var(--ch-teal-d)}
.chome-prompt-ic{color:var(--ch-text-4);font-size:13px;flex-shrink:0;margin-top:1px}
.chome-prompt:hover .chome-prompt-ic{color:var(--ch-teal)}

/* ── Trending shortages ── */
.chome-trending{margin-top:40px}
.chome-trending-head{display:flex;align-items:center;justify-content:space-between;
  margin-bottom:13px;padding:0 2px}
.chome-trending-label{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:var(--ch-text-4)}
.chome-trending-link{font-size:12px;color:var(--ch-text-3);text-decoration:none}
.chome-trending-link:hover{color:var(--ch-teal-d)}
.chome-trending-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.chome-card{display:block;background:var(--ch-bg);border:1px solid var(--ch-border);border-radius:12px;
  padding:14px;text-decoration:none;color:inherit;transition:.16s}
.chome-card:hover{border-color:var(--ch-border-2);transform:translateY(-2px);
  box-shadow:0 10px 24px -10px rgba(12,17,24,.16)}
.chome-card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}
.chome-card-flag{font-size:14px}
.chome-card-pill{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;
  padding:3px 8px;border-radius:6px}
.chome-card-pill.crit{background:var(--ch-crit-bg);color:var(--ch-crit);border:1px solid var(--ch-crit-b)}
.chome-card-pill.high{background:var(--ch-high-bg);color:var(--ch-high);border:1px solid var(--ch-high-b)}
.chome-card-pill.med{background:var(--ch-med-bg);color:var(--ch-med);border:1px solid var(--ch-med-b)}
.chome-card-pill.low{background:var(--ch-low-bg);color:var(--ch-low);border:1px solid var(--ch-low-b)}
.chome-card-dot{width:5px;height:5px;border-radius:50%;background:currentColor}
.chome-card-name{font-size:14px;font-weight:600;letter-spacing:-.01em;line-height:1.3;
  margin-bottom:4px;color:var(--ch-text)}
.chome-card-meta{font-size:11px;color:var(--ch-text-4);margin-bottom:10px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chome-card-stat{display:flex;align-items:center;justify-content:space-between;
  padding-top:9px;border-top:1px solid var(--ch-border);font-size:11px;color:var(--ch-text-3)}
.chome-card-val{font-weight:600;color:var(--ch-text)}

@media(max-width:900px){.chome-trending-grid{grid-template-columns:1fr 1fr}}
@media(max-width:640px){.chome-prompts{grid-template-columns:1fr}.chome-trending-grid{grid-template-columns:1fr}}
`;
