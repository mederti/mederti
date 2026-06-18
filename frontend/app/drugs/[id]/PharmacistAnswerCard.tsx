"use client";

import { useState } from "react";
import ClinicalDisclaimer from "@/app/components/ClinicalDisclaimer";
import { affinity } from "@/lib/alternatives";
import {
  Sparkles,
  Baby,
  Check,
  ChevronDown,
  ChevronUp,
  Bell,
  FileText,
  MoreHorizontal,
} from "lucide-react";

interface TopAlternative {
  name: string;
  form: string;
  isAvailable: boolean;
  matchPercent: number | null;
  isPbsListed?: boolean;
  priceAud?: number;
  clinicalReasoning: string;
}

interface PaediatricAlternative {
  name: string;
  form: string;
  priceAud?: number;
  isAvailable: boolean;
}

interface ExpectedReturn {
  label: string;
  range: string;
  confidence: number;
}

interface AdjacentMarket {
  country: string;
  flag: string;
  price: string;
  delta: number;
}

interface TradePrice {
  au: { value: string; unit: string; updatedDaysAgo: number };
  adjacent: AdjacentMarket[];
}

interface Status {
  label: string;
  severity: "critical" | "high" | "medium" | "low";
  markets: string;
}

interface Props {
  drugName: string;
  genericName: string;
  atcCode?: string;
  status: Status;
  topAlternative: TopAlternative | null;
  paediatricAlternative?: PaediatricAlternative | null;
  expectedReturn?: ExpectedReturn | null;
  tradePrice?: TradePrice | null;
}

const SEVERITY: Record<
  Status["severity"],
  { color: string; bg: string; border: string }
> = {
  critical: { color: "var(--crit)", bg: "var(--crit-bg)", border: "var(--crit-b)" },
  high:     { color: "var(--high)", bg: "var(--high-bg)", border: "var(--high-b)" },
  medium:   { color: "var(--high)", bg: "var(--high-bg)", border: "var(--high-b)" },
  low:      { color: "var(--low)",  bg: "var(--low-bg)",  border: "var(--low-b)" },
};

function formatAud(value?: number): string | null {
  if (value === undefined || value === null) return null;
  return `$${value.toFixed(2)} AUD`;
}

export default function PharmacistAnswerCard({
  drugName,
  genericName,
  atcCode,
  status,
  topAlternative,
  paediatricAlternative,
  expectedReturn,
  tradePrice,
}: Props) {
  const [whyOpen, setWhyOpen] = useState(false);
  const sev = SEVERITY[status.severity];

  const genericLine = atcCode ? `${genericName} · ATC ${atcCode}` : genericName;

  return (
    <section
      style={{
        marginBottom: 28,
        fontFamily: "var(--font-inter), sans-serif",
      }}
    >
      {/* ============== Header ============== */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 24,
          paddingBottom: 22,
          borderBottom: "1px solid var(--app-border)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: "-0.025em",
              color: "var(--app-text)",
              lineHeight: 1.15,
            }}
          >
            {drugName}
          </div>
          <div
            style={{ fontSize: 14, color: "var(--app-text-3)", marginTop: 4 }}
          >
            {genericLine}
          </div>
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            background: sev.bg,
            border: `1px solid ${sev.border}`,
            borderRadius: 10,
            flexShrink: 0,
          }}
        >
          <span
            className="pac-blink"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: sev.color,
              display: "inline-block",
            }}
          />
          <span
            style={{ fontSize: 13, fontWeight: 500, color: sev.color }}
          >
            <strong style={{ fontWeight: 600 }}>{status.label}</strong> ·{" "}
            {status.severity}
          </span>
          <span
            style={{
              fontSize: 11,
              color: sev.color,
              opacity: 0.7,
              fontFamily: "var(--font-dm-mono), monospace",
              marginLeft: 4,
            }}
          >
            {status.markets}
          </span>
        </div>
      </div>

      {/* ============== Grid ============== */}
      <div
        className="pac-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr",
          gap: 24,
          marginTop: 24,
        }}
      >
        {/* ============== LEFT COLUMN ============== */}
        <div>
          {topAlternative && (
            <div
              style={{
                background: "var(--app-bg-2)",
                border: "1px solid var(--teal-b)",
                borderRadius: 14,
                padding: 24,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "var(--teal)",
                  marginBottom: 10,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Sparkles size={11} /> Recommended substitute
              </div>
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: "var(--app-text)",
                  lineHeight: 1.15,
                }}
              >
                {topAlternative.name}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--app-text-3)",
                  marginTop: 4,
                }}
              >
                {topAlternative.form}
              </div>

              {/* Pills */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginTop: 14,
                }}
              >
                {topAlternative.isAvailable && (
                  <Pill tone="positive">Available in AU</Pill>
                )}
                {affinity(topAlternative.matchPercent) && (
                  <Pill tone="neutral">
                    {affinity(topAlternative.matchPercent)}
                  </Pill>
                )}
                {topAlternative.isPbsListed && (
                  <Pill tone="neutral">PBS listed</Pill>
                )}
                {formatAud(topAlternative.priceAud) && (
                  <Pill tone="neutral">{formatAud(topAlternative.priceAud)}</Pill>
                )}
              </div>

              {/* Reasoning */}
              <div
                style={{
                  fontSize: 13,
                  color: "var(--app-text-2)",
                  lineHeight: 1.65,
                  marginTop: 18,
                  paddingTop: 18,
                  borderTop: "1px dashed var(--app-border)",
                }}
              >
                {topAlternative.clinicalReasoning}
              </div>

              {/* Actions */}
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  marginTop: 18,
                  flexWrap: "wrap",
                }}
              >
                {/* TODO: wire up Draft prescriber note handler */}
                <button
                  type="button"
                  style={{
                    padding: "11px 18px",
                    background: "var(--app-text)",
                    border: 0,
                    borderRadius: 9,
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 500,
                    fontFamily: "var(--font-inter), sans-serif",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <FileText size={13} /> Draft prescriber note
                </button>
                <button
                  type="button"
                  style={{
                    padding: "11px 16px",
                    background: "var(--app-bg-2)",
                    border: "1px solid var(--app-border)",
                    borderRadius: 9,
                    color: "var(--app-text-2)",
                    fontSize: 13,
                    fontWeight: 500,
                    fontFamily: "var(--font-inter), sans-serif",
                    cursor: "pointer",
                  }}
                >
                  Compare 4 alternatives
                </button>
                <button
                  type="button"
                  aria-label="More options"
                  style={{
                    padding: "11px 14px",
                    background: "var(--app-bg-2)",
                    border: "1px solid var(--app-border)",
                    borderRadius: 9,
                    color: "var(--app-text-2)",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <MoreHorizontal size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Paediatric secondary card */}
          {paediatricAlternative && (
            <div
              style={{
                background: "var(--app-bg-2)",
                border: "1px solid var(--app-border)",
                borderRadius: 12,
                padding: "14px 16px",
                display: "flex",
                alignItems: "center",
                gap: 14,
                marginTop: 16,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 9,
                  background: "var(--teal-bg)",
                  color: "var(--teal)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Baby size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 500,
                    color: "var(--app-text-4)",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    marginBottom: 2,
                  }}
                >
                  For under 12s
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: "var(--app-text)",
                  }}
                >
                  {paediatricAlternative.name}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--app-text-3)",
                    marginTop: 1,
                  }}
                >
                  {paediatricAlternative.form}
                  {formatAud(paediatricAlternative.priceAud)
                    ? ` · ${formatAud(paediatricAlternative.priceAud)}`
                    : ""}
                </div>
              </div>
              {paediatricAlternative.isAvailable && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--low)",
                    fontWeight: 500,
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Check size={13} /> Available
                </div>
              )}
            </div>
          )}

          {/* Why-this-recommendation toggle */}
          {topAlternative && (
            <button
              type="button"
              onClick={() => setWhyOpen((v) => !v)}
              style={{
                marginTop: 16,
                width: "100%",
                padding: 13,
                border: "1px solid var(--app-border)",
                borderRadius: 10,
                background: "var(--app-bg-2)",
                fontSize: 13,
                color: "var(--app-text-3)",
                fontFamily: "var(--font-inter), sans-serif",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                cursor: "pointer",
              }}
            >
              {whyOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Why this recommendation? See clinical reasoning & source data
            </button>
          )}

          {whyOpen && topAlternative && (
            <div
              style={{
                marginTop: 10,
                padding: 16,
                border: "1px solid var(--app-border)",
                borderRadius: 10,
                background: "var(--app-bg-2)",
                fontSize: 12.5,
                color: "var(--app-text-2)",
                lineHeight: 1.65,
              }}
            >
              {topAlternative.clinicalReasoning}
            </div>
          )}
        </div>

        {/* ============== RIGHT SIDEBAR ============== */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* Expected return */}
          {expectedReturn && (
            <div
              style={{
                background: "var(--app-bg-2)",
                border: "1px solid var(--app-border)",
                borderRadius: 12,
                padding: "16px 18px",
              }}
            >
              <div style={cardLabelStyle}>{expectedReturn.label}</div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 600,
                  color: "var(--app-text)",
                  letterSpacing: "-0.01em",
                }}
              >
                {expectedReturn.range}
              </div>
              {/* Confidence meter shown ONLY if a real confidence value is
                  supplied (>0). The previous fabricated 74/61/0 heuristic is
                  gone, so this stays hidden until a genuine metric exists. */}
              {expectedReturn.confidence > 0 && (
                <>
                  <div
                    style={{
                      marginTop: 10,
                      height: 4,
                      background: "var(--app-bg)",
                      borderRadius: 2,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.min(
                          Math.max(expectedReturn.confidence, 0),
                          100
                        )}%`,
                        height: "100%",
                        background:
                          "linear-gradient(90deg, var(--teal) 0%, var(--teal-3, #34d399) 100%)",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: 11,
                      color: "var(--app-text-4)",
                      marginTop: 6,
                      fontFamily: "var(--font-dm-mono), monospace",
                    }}
                  >
                    <span>AI confidence</span>
                    <strong style={{ color: "var(--teal)", fontWeight: 600 }}>
                      {expectedReturn.confidence} / 100
                    </strong>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Trade price */}
          {tradePrice && (
            <div
              style={{
                background: "var(--app-bg-2)",
                border: "1px solid var(--app-border)",
                borderRadius: 12,
                padding: "16px 18px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  paddingBottom: 14,
                  borderBottom: "1px solid var(--app-border)",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ ...cardLabelStyle, marginBottom: 4 }}>
                    🇦🇺 Trade price · AU
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-dm-mono), monospace",
                      fontSize: 26,
                      fontWeight: 600,
                      color: "var(--app-text)",
                      letterSpacing: "-0.02em",
                      lineHeight: 1,
                    }}
                  >
                    {tradePrice.au.value}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--app-text-3)",
                      marginTop: 5,
                    }}
                  >
                    {tradePrice.au.unit}
                  </div>
                </div>
                <div
                  style={{
                    textAlign: "right",
                    fontSize: 10,
                    color: "var(--app-text-4)",
                    fontFamily: "var(--font-dm-mono), monospace",
                    lineHeight: 1.5,
                  }}
                >
                  <strong style={{ color: "var(--app-text-3)", fontWeight: 500 }}>
                    30d median
                  </strong>
                  <br />
                  updated {tradePrice.au.updatedDaysAgo}d ago
                </div>
              </div>

              {tradePrice.adjacent.length > 0 && (
                <>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--app-text-4)",
                      margin: "14px 0 10px",
                    }}
                  >
                    Adjacent markets · same SKU
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 9,
                    }}
                  >
                    {tradePrice.adjacent.map((m) => (
                      <div
                        key={`${m.country}-${m.price}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "18px 1fr auto 50px",
                          gap: 10,
                          alignItems: "center",
                          fontSize: 12,
                        }}
                      >
                        <span style={{ fontSize: 14, lineHeight: 1 }}>
                          {m.flag}
                        </span>
                        <span
                          style={{
                            color: "var(--app-text-2)",
                            fontWeight: 500,
                          }}
                        >
                          {m.country}
                        </span>
                        <span
                          style={{
                            color: "var(--app-text)",
                            fontFamily: "var(--font-dm-mono), monospace",
                          }}
                        >
                          {m.price}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontFamily: "var(--font-dm-mono), monospace",
                            textAlign: "right",
                            color:
                              m.delta > 0
                                ? "var(--crit)"
                                : m.delta < 0
                                ? "var(--low)"
                                : "var(--app-text-4)",
                          }}
                        >
                          {m.delta > 0 ? "+" : ""}
                          {m.delta}%
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Alert card */}
          <div
            style={{
              background: "var(--app-bg-2)",
              border: "1px solid var(--app-border)",
              borderRadius: 12,
              padding: 16,
            }}
          >
            <a
              href="/account#alerts"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: "100%",
                padding: "12px 16px",
                background: "var(--teal)",
                color: "#fff",
                border: 0,
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 500,
                fontFamily: "var(--font-inter), sans-serif",
                textDecoration: "none",
                cursor: "pointer",
              }}
            >
              <Bell size={14} /> Alert me when stock returns
            </a>
            <div
              style={{
                textAlign: "center",
                fontSize: 11,
                color: "var(--app-text-4)",
                marginTop: 8,
              }}
            >
              Email + SMS · the moment any AU supplier lists stock
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <ClinicalDisclaimer compact />
      </div>

      <style>{`
        .pac-blink {
          animation: pac-blink 1.6s ease-in-out infinite;
        }
        @keyframes pac-blink {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.35; }
        }
        @media (max-width: 768px) {
          .pac-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}

/* ---------- helpers ---------- */

const cardLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--app-text-4)",
  marginBottom: 8,
};

function Pill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "positive" | "neutral";
}) {
  const positive = tone === "positive";
  return (
    <span
      style={{
        fontSize: 11,
        padding: "4px 10px",
        borderRadius: 5,
        fontWeight: 500,
        background: positive ? "var(--low-bg)" : "var(--app-bg)",
        color: positive ? "var(--low)" : "var(--app-text-3)",
        border: `1px solid ${positive ? "var(--low-b)" : "var(--app-border)"}`,
      }}
    >
      {children}
    </span>
  );
}
