import Link from "next/link";
import { Bell, Package } from "lucide-react";
import { affinity } from "@/lib/alternatives";

interface AdjacentMarket {
  country: string;
  flag: string;
  price: string;
  delta: number;
}

interface Alternative {
  name: string;
  matchPercent: number | null;
  isAvailable: boolean;
}

interface Source {
  regulator: string;
  country: string;
  flag: string;
  hoursAgo: number;
}

interface ManufacturerConcentration {
  count: number;
  band: "unknown" | "high_risk" | "moderate_risk" | "low_risk";
  usdmf?: number;
  cep?: number;
  euWc?: number;
}

interface Props {
  drugName: string;
  genericName: string;
  atcCode?: string;
  status: {
    label: string;
    severity: "critical" | "high" | "medium" | "low";
    markets: string;
    sinceLabel?: string;
  };
  expectedReturn?: { label: string; range: string; confidence: number } | null;
  topAlternative?: {
    name: string;
    form: string;
    matchPercent: number | null;
    isAvailable: boolean;
    priceAud?: number;
  } | null;
  tradePrice?: {
    au: { value: string; currency: string; pack: string; updatedLabel: string };
    adjacent: AdjacentMarket[];
  } | null;
  alternatives: Alternative[];
  sources: Source[];
  manufacturer?: ManufacturerConcentration | null;
}

const SEVERITY: Record<
  Props["status"]["severity"],
  { color: string; bg: string; border: string }
> = {
  critical: { color: "var(--crit)", bg: "var(--crit-bg)", border: "var(--crit-b)" },
  high: { color: "var(--crit)", bg: "var(--crit-bg)", border: "var(--crit-b)" },
  medium: { color: "var(--med)", bg: "var(--low-bg)", border: "var(--low-b)" },
  low: { color: "var(--low)", bg: "var(--low-bg)", border: "var(--low-b)" },
};

function formatHours(h: number): string {
  if (h < 1) return "just now";
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function formatAud(value?: number): string | null {
  if (value === undefined || value === null) return null;
  return `$${value.toFixed(2)} AUD`;
}

const tileBase: React.CSSProperties = {
  background: "var(--app-bg)",
  border: "1px solid var(--app-border)",
  borderRadius: 10,
  padding: "16px 18px",
  display: "flex",
  flexDirection: "column",
  position: "relative",
  minWidth: 0,
  overflow: "hidden",
};

const tileLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--app-text-4)",
};

const tileExtraStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--app-text-4)",
  fontFamily: "var(--font-dm-mono), monospace",
  position: "absolute",
  top: 16,
  right: 18,
};

export default function SupplierView({
  drugName,
  genericName,
  atcCode,
  status,
  expectedReturn,
  topAlternative,
  tradePrice,
  alternatives,
  sources,
  manufacturer,
}: Props) {
  const sev = SEVERITY[status.severity];
  const isCritical = status.severity === "critical";
  const isUrgent = status.severity === "critical" || status.severity === "high";
  const genericLine = atcCode
    ? `${genericName} · ATC ${atcCode}`
    : genericName;

  // Supplier-focused CTA: when there's a shortage in AU, frame as an opportunity to
  // list stock; otherwise, encourage responding to enquiries from pharmacies.
  const actionLabel = isUrgent ? "List your stock" : "Respond to enquiries";
  const actionSub = isUrgent
    ? "Pharmacies are searching now. Be first to surface as a verified supplier."
    : "Get notified the moment a pharmacy requests this SKU.";
  const actionHref = "/supplier-dashboard/inbox";

  return (
    <section
      style={{
        fontFamily: "var(--font-inter), sans-serif",
        padding: "22px 0 36px",
      }}
    >
      {/* ============== Header ============== */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "var(--app-text)",
              lineHeight: 1.15,
            }}
          >
            {drugName}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--app-text-3)",
              marginTop: 3,
              fontFamily: "var(--font-dm-mono), monospace",
            }}
          >
            {genericLine}
          </div>
        </div>
      </div>

      {/* ============== Bento grid ============== */}
      <div className="sv-grid">
        {/* ---------- Row 1: Status (w2) ---------- */}
        <div
          className="sv-tile sv-w2"
          style={{
            ...tileBase,
            background: sev.bg,
            borderColor: sev.border,
          }}
        >
          <div style={{ ...tileLabelStyle, color: sev.color, opacity: 0.75 }}>
            Status
          </div>
          <div style={{ ...tileExtraStyle, color: sev.color, opacity: 0.75 }}>
            {status.markets}
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: sev.color,
              letterSpacing: "-0.015em",
              marginTop: 8,
              display: "flex",
              alignItems: "center",
              gap: 8,
              lineHeight: 1.15,
            }}
          >
            <span
              className="sv-blink"
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: sev.color,
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            {status.label}
          </div>
          <div
            style={{
              fontSize: 11,
              color: sev.color,
              opacity: 0.75,
              fontFamily: "var(--font-dm-mono), monospace",
              marginTop: 6,
            }}
          >
            {status.severity}
            {status.sinceLabel ? ` · ${status.sinceLabel}` : ""}
          </div>
        </div>

        {/* ---------- Row 1: Expected return (w2) ---------- */}
        <div className="sv-tile sv-w2" style={tileBase}>
          <div style={tileLabelStyle}>Expected return</div>
          <div style={tileExtraStyle}>
            {expectedReturn ? "sponsor estimate" : "no forecast"}
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              marginTop: 4,
            }}
          >
            <div
              style={{
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: "-0.015em",
                color: expectedReturn ? "var(--app-text)" : "var(--app-text-4)",
                lineHeight: 1.1,
                fontFamily: "var(--font-dm-mono), monospace",
              }}
            >
              {expectedReturn ? expectedReturn.range : "—"}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--app-text-3)",
                fontFamily: "var(--font-dm-mono), monospace",
                marginTop: 6,
              }}
            >
              {expectedReturn ? "via regulator notice" : "No estimate provided"}
            </div>
          </div>
          {expectedReturn && expectedReturn.confidence > 0 && (
            <div
              style={{
                height: 4,
                background: "var(--app-bg-2)",
                borderRadius: 2,
                overflow: "hidden",
                marginTop: 10,
              }}
            >
              <div
                style={{
                  height: "100%",
                  background: "var(--teal)",
                  width: `${Math.max(0, Math.min(100, expectedReturn.confidence))}%`,
                }}
              />
            </div>
          )}
        </div>

        {/* ---------- Row 1: Top substitute (w2) ---------- */}
        {topAlternative ? (
          <div className="sv-tile sv-w2" style={tileBase}>
            <div style={tileLabelStyle}>Top substitute</div>
            <div style={tileExtraStyle}>
              {affinity(topAlternative.matchPercent) ?? "alternative"}
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "var(--app-text)",
                marginTop: 14,
                letterSpacing: "-0.01em",
                lineHeight: 1.2,
              }}
            >
              {topAlternative.name}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--app-text-3)",
                marginTop: 2,
              }}
            >
              {topAlternative.form}
            </div>
            <div
              style={{
                display: "flex",
                gap: 6,
                marginTop: 10,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  padding: "3px 7px",
                  borderRadius: 4,
                  fontWeight: 500,
                  background: topAlternative.isAvailable
                    ? "var(--low-bg)"
                    : "var(--crit-bg)",
                  color: topAlternative.isAvailable
                    ? "var(--low)"
                    : "var(--crit)",
                  border: `1px solid ${
                    topAlternative.isAvailable
                      ? "var(--low-b)"
                      : "var(--crit-b)"
                  }`,
                }}
              >
                {topAlternative.isAvailable ? "Available" : "Constrained"}
              </span>
              {formatAud(topAlternative.priceAud) && (
                <span
                  style={{
                    fontSize: 10,
                    padding: "3px 7px",
                    borderRadius: 4,
                    fontWeight: 500,
                    background: "var(--app-bg-2)",
                    color: "var(--app-text-3)",
                    border: "1px solid var(--app-border)",
                  }}
                >
                  {formatAud(topAlternative.priceAud)}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="sv-tile sv-w2" style={tileBase}>
            <div style={tileLabelStyle}>Top substitute</div>
            <div style={tileExtraStyle}>none mapped</div>
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                marginTop: 4,
              }}
            >
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "var(--app-text-4)",
                  letterSpacing: "-0.01em",
                  lineHeight: 1.2,
                }}
              >
                No alternatives in catalogue
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--app-text-3)",
                  marginTop: 6,
                  lineHeight: 1.5,
                }}
              >
                Therapeutic class match not yet indexed for this drug.
                Ask the chat panel for clinical-equivalence guidance.
              </div>
            </div>
          </div>
        )}

        {/* ---------- Row 2: Trade price (w4) ---------- */}
        {tradePrice ? (
          <div className="sv-tile sv-w4" style={tileBase}>
            <div style={tileLabelStyle}>
              Trade price — AU + adjacent markets
            </div>
            <div style={tileExtraStyle}>
              30d median · {tradePrice.au.updatedLabel}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                marginTop: 14,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-dm-mono), monospace",
                  fontSize: 22,
                  fontWeight: 600,
                  color: "var(--app-text)",
                }}
              >
                🇦🇺 {tradePrice.au.value}
              </div>
              <div style={{ fontSize: 11, color: "var(--app-text-3)" }}>
                {tradePrice.au.currency} · {tradePrice.au.pack}
              </div>
            </div>
            {tradePrice.adjacent.length > 0 && (
              <div
                className="sv-price-strip"
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${Math.min(
                    5,
                    tradePrice.adjacent.length
                  )}, 1fr)`,
                  gap: 6,
                  marginTop: 12,
                }}
              >
                {tradePrice.adjacent.slice(0, 5).map((m) => {
                  const isUp = m.delta > 0;
                  const isFlat = m.delta === 0;
                  const deltaColor = isFlat
                    ? "var(--app-text-4)"
                    : isUp
                    ? "var(--crit)"
                    : "var(--low)";
                  const sign = isUp ? "+" : "";
                  return (
                    <div
                      key={m.country}
                      style={{
                        padding: "7px 9px",
                        background: "var(--app-bg-2)",
                        borderRadius: 6,
                        fontSize: 11,
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          color: "var(--app-text-3)",
                          marginBottom: 2,
                        }}
                      >
                        <span style={{ fontSize: 12 }}>{m.flag}</span>
                        {m.country}
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--font-dm-mono), monospace",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--app-text)",
                          display: "flex",
                          alignItems: "baseline",
                          justifyContent: "space-between",
                          gap: 4,
                          minWidth: 0,
                        }}
                      >
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {m.price}
                        </span>
                        <span style={{ fontSize: 9, color: deltaColor }}>
                          {sign}
                          {m.delta}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="sv-tile sv-w4" style={tileBase}>
            <div style={tileLabelStyle}>Trade price — AU + adjacent markets</div>
            <div style={tileExtraStyle}>awaiting wholesaler data</div>
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: 6,
                marginTop: 4,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-dm-mono), monospace",
                  fontSize: 18,
                  fontWeight: 600,
                  color: "var(--app-text-4)",
                  letterSpacing: "-0.01em",
                }}
              >
                🇦🇺 Awaiting Sigma · Symbion feed
              </div>
              <div style={{ fontSize: 11, color: "var(--app-text-3)", lineHeight: 1.5 }}>
                AU wholesaler trade pricing arrives once distributor feeds are
                connected. Mederti pulls public reference pricing today.
              </div>
            </div>
          </div>
        )}

        {/* ---------- Row 2: Action (w2, dark) ---------- */}
        <Link
          href={actionHref}
          className="sv-tile sv-w2 sv-action"
          style={{
            ...tileBase,
            background: "var(--app-text)",
            borderColor: "var(--app-text)",
            color: "#fff",
            textDecoration: "none",
            cursor: "pointer",
          }}
        >
          <div
            style={{
              ...tileLabelStyle,
              color: "rgba(255,255,255,0.55)",
            }}
          >
            Action
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              marginTop: 6,
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "#fff",
              }}
            >
              {actionLabel}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.65)",
                marginTop: 3,
                lineHeight: 1.5,
              }}
            >
              {actionSub}
            </div>
          </div>
          <div
            style={{
              width: "100%",
              marginTop: 10,
              padding: 9,
              background: "var(--teal)",
              border: 0,
              borderRadius: 6,
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "var(--font-inter), sans-serif",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              boxSizing: "border-box",
            }}
          >
            {isCritical ? <Package size={13} /> : <Bell size={13} />}
            {isCritical ? "List stock" : "Open inbox"}
          </div>
        </Link>

        {/* ---------- Row 2.5: Manufacturer concentration (w6) ---------- */}
        {manufacturer && (
          <div className="sv-tile sv-w6" style={{ ...tileBase, flexDirection: "row", alignItems: "center", gap: 20 }}>
            <div style={{ flexShrink: 0 }}>
              <div style={tileLabelStyle}>Manufacturer concentration</div>
              <div style={{
                fontFamily: "var(--font-dm-mono), monospace",
                fontSize: 22,
                fontWeight: 600,
                color: "var(--app-text)",
                marginTop: 6,
                letterSpacing: "-0.015em",
              }}>
                {manufacturer.count.toLocaleString()}
                <span style={{ fontSize: 12, color: "var(--app-text-4)", fontWeight: 500 }}> qualified suppliers</span>
              </div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <SvRiskPill band={manufacturer.band} />
              <div style={{
                fontSize: 11, color: "var(--app-text-3)",
                fontFamily: "var(--font-dm-mono), monospace",
                display: "flex", gap: 14, flexWrap: "wrap",
              }}>
                {manufacturer.usdmf !== undefined && (<span><strong style={{ color: "var(--app-text-2)" }}>{manufacturer.usdmf}</strong> USDMF</span>)}
                {manufacturer.cep !== undefined && (<span><strong style={{ color: "var(--app-text-2)" }}>{manufacturer.cep}</strong> CEP</span>)}
                {manufacturer.euWc !== undefined && (<span><strong style={{ color: "var(--app-text-2)" }}>{manufacturer.euWc}</strong> EU WC</span>)}
                <span style={{ color: "var(--app-text-4)" }}>· PharmaCompass</span>
              </div>
            </div>
          </div>
        )}

        {/* ---------- Row 3: Alternatives (w3 h2) ---------- */}
        {alternatives.length > 0 ? (
          <div className="sv-tile sv-w3 sv-h2" style={tileBase}>
            <div style={tileLabelStyle}>Alternatives</div>
            <div style={tileExtraStyle}>
              {alternatives.length} option{alternatives.length === 1 ? "" : "s"}{" "}
              · ranked
            </div>
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                marginTop: 14,
              }}
            >
              {alternatives.map((a, i) => (
                <div
                  key={`${a.name}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 12,
                    padding: "5px 0",
                    borderBottom:
                      i === alternatives.length - 1
                        ? "0"
                        : "1px solid var(--app-border)",
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      color: "var(--app-text)",
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                    }}
                  >
                    {a.name}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-dm-mono), monospace",
                        fontSize: 10,
                        color: "var(--app-text-4)",
                      }}
                    >
                      {affinity(a.matchPercent) ?? "—"}
                    </span>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: a.isAvailable
                          ? "var(--low)"
                          : "var(--med)",
                        display: "inline-block",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="sv-tile sv-w3 sv-h2" style={tileBase}>
            <div style={tileLabelStyle}>Alternatives</div>
            <div style={tileExtraStyle}>indexing</div>
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                marginTop: 14,
                gap: 10,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--app-text-4)",
                  letterSpacing: "-0.005em",
                }}
              >
                No therapeutic alternatives indexed yet
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--app-text-3)",
                  lineHeight: 1.6,
                }}
              >
                Our clinical-equivalence graph is being expanded. For
                this drug, clinical alternatives need to be cross-referenced
                against the ATC class and prescriber-substitution guidelines
                before they appear here.
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--app-text-4)",
                  fontFamily: "var(--font-dm-mono), monospace",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginTop: 4,
                }}
              >
                Path B · clinical-equivalence pipeline
              </div>
            </div>
          </div>
        )}

        {/* ---------- Row 3: Sources (w3) ---------- */}
        {sources.length > 0 ? (
          <div className="sv-tile sv-w3" style={tileBase}>
            <div style={tileLabelStyle}>Verified sources</div>
            <div style={tileExtraStyle}>
              {sources.length} regulator{sources.length === 1 ? "" : "s"}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 5,
                marginTop: 14,
              }}
            >
              {sources.slice(0, 5).map((s, i) => (
                <div
                  key={`${s.regulator}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 11,
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      color: "var(--app-text)",
                      minWidth: 0,
                    }}
                  >
                    <span style={{ fontSize: 12 }}>{s.flag}</span>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.regulator}
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-dm-mono), monospace",
                      color: "var(--app-text-4)",
                      fontSize: 10,
                      flexShrink: 0,
                    }}
                  >
                    {formatHours(s.hoursAgo)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="sv-tile sv-w3" style={tileBase}>
            <div style={tileLabelStyle}>Verified sources</div>
            <div style={tileExtraStyle}>none active</div>
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                marginTop: 4,
                gap: 6,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--app-text-4)" }}>
                No active regulator notices
              </div>
              <div style={{ fontSize: 11, color: "var(--app-text-3)", lineHeight: 1.5 }}>
                Regulators continuously monitored across major markets. None
                currently report an active shortage event for this drug.
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .sv-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          grid-auto-rows: 130px;
          gap: 12px;
        }
        .sv-w2 { grid-column: span 2; }
        .sv-w3 { grid-column: span 3; }
        .sv-w4 { grid-column: span 4; }
        .sv-w6 { grid-column: span 6; }
        .sv-h2 { grid-row: span 2; }
        .sv-action:hover { filter: brightness(1.08); }
        .sv-blink { animation: sv-blink 1.6s ease-in-out infinite; }
        @keyframes sv-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @media (max-width: 768px) {
          .sv-grid {
            grid-template-columns: repeat(2, 1fr);
            grid-auto-rows: auto;
          }
          .sv-w2, .sv-w3, .sv-w4, .sv-w6 { grid-column: span 2; }
          .sv-h2 { grid-row: auto; }
        }
      `}</style>
    </section>
  );
}

function SvRiskPill({ band }: { band: "unknown" | "high_risk" | "moderate_risk" | "low_risk" }) {
  const palette: Record<typeof band, { label: string; c: string; bg: string; b: string }> = {
    high_risk:     { label: "High concentration risk",     c: "var(--crit)", bg: "var(--crit-bg)", b: "var(--crit-b)" },
    moderate_risk: { label: "Moderate concentration risk", c: "var(--med)",  bg: "var(--med-bg)",  b: "var(--med-b)"  },
    low_risk:      { label: "Diverse supplier base",       c: "var(--low)",  bg: "var(--low-bg)",  b: "var(--low-b)"  },
    unknown:       { label: "Concentration unknown",       c: "var(--app-text-4)", bg: "var(--app-bg-2)", b: "var(--app-border)" },
  };
  const s = palette[band];
  return (
    <span style={{
      fontSize: 10, padding: "4px 9px", borderRadius: 5,
      fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase",
      fontFamily: "var(--font-dm-mono), monospace",
      background: s.bg, color: s.c, border: `1px solid ${s.b}`,
      width: "fit-content",
    }}>
      {s.label}
    </span>
  );
}
