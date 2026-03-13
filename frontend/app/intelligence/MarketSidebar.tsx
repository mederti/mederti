"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

/* ── Types mirroring API response ── */
interface StockQuote { ticker: string; name: string; price: number; change: number; changePercent: number; }
interface CurrencyQuote { pair: string; label: string; rate: number; change: number; changePercent: number; }
interface FreightData { index: number; change: number; changePercent: number; sparkline: number[]; }
interface CommodityRow { name: string; price: number; unit: string; trend: number; }
interface FdaApproval { drugName: string; applicationType: string; status: string; date: string; url: string; }
interface MarketData {
  stocks: StockQuote[]; shortageManufacturerCount: number;
  currencies: CurrencyQuote[]; freight: FreightData;
  commodities: CommodityRow[]; fda: FdaApproval[];
  updatedAt: string; errors: string[];
}

/* ── Helpers ── */
const mono: React.CSSProperties = { fontFamily: "var(--font-dm-mono), monospace" };
const SECTION_LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, letterSpacing: "0.10em",
  textTransform: "uppercase", color: "#64748b", marginBottom: 12,
};
const DIVIDER: React.CSSProperties = {
  height: 1, background: "#e5e7eb", margin: "16px 0",
};

function Arrow({ positive }: { positive: boolean }) {
  return (
    <span style={{ color: positive ? "#16a34a" : "#dc2626", fontSize: 11, marginRight: 2 }}>
      {positive ? "▲" : "▼"}
    </span>
  );
}

function PctChange({ value }: { value: number }) {
  const pos = value >= 0;
  return (
    <span style={{ ...mono, fontSize: 12, color: pos ? "#16a34a" : "#dc2626", whiteSpace: "nowrap" }}>
      <Arrow positive={pos} />
      {pos ? "+" : ""}{value.toFixed(2)}%
    </span>
  );
}

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return <span title={text} style={{ cursor: "help", borderBottom: "1px dotted #cbd5e1" }}>{children}</span>;
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ── Sparkline (pure SVG) ── */
function Sparkline({ data, width = 140, height = 32 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  const trending = data[data.length - 1] >= data[0];
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline
        points={points}
        fill="none"
        stroke={trending ? "#16a34a" : "#dc2626"}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ── Pulsing live dot ── */
function LiveDot() {
  return (
    <span style={{ position: "relative", display: "inline-block", width: 8, height: 8, marginRight: 8 }}>
      <span style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: "#16a34a", animation: "pulse-dot 2s ease-in-out infinite",
      }} />
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.4); }
        }
      `}</style>
    </span>
  );
}

/* ── Section error fallback ── */
function SectionError({ label, lastUpdated }: { label: string; lastUpdated?: string }) {
  return (
    <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 0" }}>
      Data unavailable{lastUpdated ? ` · Last updated ${timeAgo(lastUpdated)}` : ""}
      <span style={{ display: "block", fontSize: 11, marginTop: 2 }}>{label}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   MarketSidebar
   ══════════════════════════════════════════════════════════ */
export default function MarketSidebar() {
  const [data, setData] = useState<MarketData | null>(null);
  const [lastGood, setLastGood] = useState<MarketData | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/market-data");
      if (!res.ok) return;
      const json: MarketData = await res.json();
      setData(json);
      setLastGood(json);
    } catch { /* keep last good */ }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 5 * 60 * 1000); // 5 min
    return () => clearInterval(id);
  }, [fetchData]);

  const d = data ?? lastGood;

  return (
    <aside className="market-sidebar" style={{
      position: "sticky", top: 24, alignSelf: "flex-start",
      fontSize: 13, color: "#0f172a", lineHeight: 1.45,
    }}>
      {/* Title */}
      <div style={{
        display: "flex", alignItems: "center", marginBottom: 20,
      }}>
        <LiveDot />
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.12em",
          textTransform: "uppercase", color: "#0f172a",
        }}>
          Market Signals
        </span>
      </div>

      {/* ─── 1. PHARMA STOCKS ─── */}
      <div style={SECTION_LABEL}>Pharma Stocks</div>
      {(!d || d.stocks.length === 0) ? (
        <SectionError label="Stock data" lastUpdated={lastGood?.updatedAt} />
      ) : (
        <>
          {d.stocks.map((s) => (
            <div key={s.ticker} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "5px 0",
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                <span style={{ ...mono, fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{s.ticker}</span>
                <span style={{ fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexShrink: 0 }}>
                <span style={{ ...mono, fontSize: 12, fontWeight: 500 }}>${s.price.toFixed(2)}</span>
                <PctChange value={s.changePercent} />
              </div>
            </div>
          ))}
          {d.shortageManufacturerCount > 0 && (
            <Link href="/dashboard" style={{
              display: "block", fontSize: 11, color: "#0d9488",
              marginTop: 8, textDecoration: "none", fontWeight: 500,
            }}>
              {d.shortageManufacturerCount} of these companies manufacture drugs currently in shortage →
            </Link>
          )}
        </>
      )}
      <div style={{ ...DIVIDER }} />

      {/* ─── 2. API COMMODITIES ─── */}
      <div style={{ ...SECTION_LABEL, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Tooltip text="API price increases typically precede shortage declarations by 3-6 months.">
          API Commodities
        </Tooltip>
        <span style={{ fontSize: 10, fontWeight: 400, letterSpacing: "0.02em", color: "#94a3b8", textTransform: "none" }}>
          Indicative · Updated weekly
        </span>
      </div>
      {d?.commodities.map((c) => (
        <div key={c.name} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "5px 0",
        }}>
          <span style={{ fontSize: 12, color: "#334155", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {c.name}
          </span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexShrink: 0 }}>
            <span style={{ ...mono, fontSize: 12, fontWeight: 500 }}>${c.price.toFixed(2)}</span>
            <PctChange value={c.trend} />
          </div>
        </div>
      ))}
      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 8, lineHeight: 1.4 }}>
        Source: industry estimates · <Link href="/contact" style={{ color: "#94a3b8", textDecoration: "underline" }}>Contact us</Link> for licensed commodity data
      </div>
      <div style={{ ...DIVIDER }} />

      {/* ─── 3. FREIGHT & LOGISTICS ─── */}
      <div style={SECTION_LABEL}>Freight &amp; Logistics</div>
      {(!d || d.freight.index === 0) ? (
        <SectionError label="Baltic Dry Index" lastUpdated={lastGood?.updatedAt} />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: "#64748b" }}>Baltic Dry Index</span>
            <span style={{ ...mono, fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
              {d.freight.index.toLocaleString()}
            </span>
            <PctChange value={d.freight.changePercent} />
          </div>
          {d.freight.sparkline.length > 2 && (
            <Sparkline data={d.freight.sparkline} width={200} height={36} />
          )}
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, lineHeight: 1.4 }}>
            Higher = more expensive shipping from manufacturing hubs.
          </div>
        </>
      )}
      <div style={{ ...DIVIDER }} />

      {/* ─── 4. KEY CURRENCIES ─── */}
      <div style={SECTION_LABEL}>
        <Tooltip text="INR and CNY movements affect API manufacturing costs. A weaker INR makes Indian API exports cheaper.">
          Key Currencies
        </Tooltip>
      </div>
      {(!d || d.currencies.length === 0) ? (
        <SectionError label="Currency data" lastUpdated={lastGood?.updatedAt} />
      ) : (
        d.currencies.map((c) => (
          <div key={c.pair} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "5px 0",
          }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: "#334155" }}>{c.label}</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ ...mono, fontSize: 12, fontWeight: 500 }}>{c.rate.toFixed(4)}</span>
              <PctChange value={c.changePercent} />
            </div>
          </div>
        ))
      )}
      <div style={{ ...DIVIDER }} />

      {/* ─── 5. FDA PIPELINE ─── */}
      <div style={SECTION_LABEL}>FDA Pipeline</div>
      {(!d || d.fda.length === 0) ? (
        <SectionError label="FDA data" lastUpdated={lastGood?.updatedAt} />
      ) : (
        <>
          {d.fda.map((f, i) => (
            <div key={i} style={{ padding: "6px 0", borderBottom: i < d.fda.length - 1 ? "1px solid #f1f5f9" : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <a href={f.url} target="_blank" rel="noopener noreferrer" style={{
                  fontSize: 12, fontWeight: 600, color: "#0f172a", textDecoration: "none",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                }}>
                  {f.drugName}
                </a>
                <span style={{
                  ...mono, fontSize: 10, fontWeight: 600, padding: "1px 5px",
                  borderRadius: 3, background: "#f1f5f9", color: "#64748b",
                  flexShrink: 0,
                }}>
                  {f.applicationType}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                <span style={{
                  fontSize: 10, fontWeight: 600, color: "#16a34a",
                  textTransform: "uppercase", letterSpacing: "0.04em",
                }}>
                  {f.status}
                </span>
                <span style={{ ...mono, fontSize: 10, color: "#94a3b8" }}>{f.date}</span>
              </div>
            </div>
          ))}
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 8, lineHeight: 1.4 }}>
            New approvals may relieve active shortages — cross-referenced with Mederti shortage data where applicable.
          </div>
        </>
      )}

      {/* ─── Footer timestamp ─── */}
      {d && (
        <div style={{ marginTop: 16, fontSize: 10, color: "#cbd5e1", textAlign: "right" }}>
          Updated {timeAgo(d.updatedAt)}
          {d.errors.length > 0 && (
            <span title={`Partial data: ${d.errors.join(", ")}`}> · ⚠ partial</span>
          )}
        </div>
      )}

      {!d && (
        <div style={{ padding: "24px 0", textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
          Loading market data…
        </div>
      )}
    </aside>
  );
}
