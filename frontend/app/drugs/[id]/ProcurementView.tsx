import { Bell } from "lucide-react";
import { affinity } from "@/lib/alternatives";

/* =========================================================================
 * ProcurementView — "D · KPI dashboard" layout for the procurement persona
 * (hospital formulary / supply chain pharmacist).
 *
 * Server component. Inline styles + CSS variables only (no Tailwind).
 * Mirrors the data shape of PharmacistAnswerCard so the parent server page
 * can pass the same props.
 * ===================================================================== */

interface AdjacentMarket {
  country: string;
  flag: string;
  price: string;
  delta: number;
}

interface Alternative {
  name: string;
  form: string;
  matchPercent: number | null;
  priceAud?: number;
  isAvailable: boolean;
}

interface Status {
  label: string;
  severity: "critical" | "high" | "medium" | "low";
  markets: string;
}

interface ExpectedReturn {
  label: string;
  confidence: number;
  range: string;
}

interface TopAlternativeSummary {
  name: string;
  matchPercent: number | null;
  isAvailable: boolean;
}

interface TradePrice {
  au: { value: string; unit: string; updatedDaysAgo: number };
  adjacent: AdjacentMarket[];
}

interface ShortageDetails {
  reason?: string;
  firstReported?: string;
  sourcesCount?: number;
  priorIncidents?: number;
}

interface ManufacturerConcentration {
  count: number;
  band: "unknown" | "high_risk" | "moderate_risk" | "low_risk";
  usdmf?: number;
  cep?: number;
  euWc?: number;
}

interface MarketSpend {
  country: string;
  year: number;
  usdPpp: number;
}

interface Props {
  drugName: string;
  genericName: string;
  atcCode?: string;
  drugClass?: string;
  status: Status;
  expectedReturn?: ExpectedReturn | null;
  topAlternative?: TopAlternativeSummary | null;
  alternatives: Alternative[];
  tradePrice?: TradePrice | null;
  shortageDetails?: ShortageDetails;
  manufacturer?: ManufacturerConcentration | null;
  marketSpend?: MarketSpend | null;
}

/* ---------- shared style fragments ---------- */

const MONO = "var(--font-dm-mono), monospace";

const moduleBase: React.CSSProperties = {
  background: "var(--app-bg)",
  border: "1px solid var(--app-border)",
  borderRadius: 10,
  padding: "18px 20px",
};

const moduleHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 14,
};

const moduleTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--app-text)",
  letterSpacing: "-0.005em",
};

const moduleMeta: React.CSSProperties = {
  fontSize: 10,
  fontFamily: MONO,
  color: "var(--app-text-4)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const kpiLabelBase: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--app-text-4)",
  marginBottom: 10,
};

const buttonSecondary: React.CSSProperties = {
  padding: "8px 14px",
  background: "transparent",
  border: "1px solid var(--app-border)",
  borderRadius: 7,
  color: "var(--app-text-3)",
  fontSize: 12,
  fontWeight: 500,
  fontFamily: "var(--font-inter), sans-serif",
  cursor: "pointer",
};

const buttonPrimary: React.CSSProperties = {
  padding: "8px 14px",
  background: "var(--app-text)",
  border: 0,
  borderRadius: 7,
  color: "#fff",
  fontSize: 12,
  fontWeight: 500,
  fontFamily: "var(--font-inter), sans-serif",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

/* ---------- component ---------- */

export default function ProcurementView({
  drugName,
  genericName,
  atcCode,
  drugClass,
  status,
  expectedReturn,
  topAlternative,
  alternatives,
  tradePrice,
  shortageDetails,
  manufacturer,
  marketSpend,
}: Props) {
  const metaParts = [
    genericName,
    atcCode ? `ATC ${atcCode}` : null,
    drugClass || null,
  ].filter(Boolean);
  const metaLine = metaParts.join(" · ");

  const isCritical = status.severity === "critical";

  const confidencePct = expectedReturn
    ? Math.min(Math.max(expectedReturn.confidence, 0), 100)
    : 0;

  const hasShortageRows =
    !!shortageDetails &&
    (shortageDetails.reason ||
      shortageDetails.firstReported ||
      shortageDetails.sourcesCount !== undefined ||
      shortageDetails.priorIncidents !== undefined);

  return (
    <section
      style={{
        padding: "22px 0 36px",
        fontFamily: "var(--font-inter), sans-serif",
      }}
    >
      {/* ============== Header ============== */}
      <div
        className="d-head"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 22,
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
            }}
          >
            {drugName}
          </div>
          {metaLine && (
            <div
              style={{
                fontSize: 12,
                color: "var(--app-text-3)",
                marginTop: 3,
                fontFamily: MONO,
              }}
            >
              {metaLine}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* TODO: wire up Compare action */}
          <button type="button" style={buttonSecondary}>
            Compare
          </button>
          {/* TODO: wire up Export action */}
          <button type="button" style={buttonSecondary}>
            Export
          </button>
          <a
            href="/alerts"
            style={{ ...buttonPrimary, textDecoration: "none" }}
          >
            <Bell size={13} /> Alert me
          </a>
        </div>
      </div>

      {/* ============== KPI tiles ============== */}
      <div
        className="d-kpis"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {/* Status */}
        <div
          style={{
            ...moduleBase,
            padding: "16px 18px",
            background: isCritical ? "var(--crit-bg)" : "var(--app-bg)",
            borderColor: isCritical ? "var(--crit-b)" : "var(--app-border)",
          }}
        >
          <div
            style={{
              ...kpiLabelBase,
              color: isCritical ? "var(--crit)" : "var(--app-text-4)",
              opacity: isCritical ? 0.75 : 1,
            }}
          >
            Status
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.015em",
              lineHeight: 1.1,
              color: isCritical ? "var(--crit)" : "var(--app-text)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {isCritical && (
              <span
                className="pv-blink"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--crit)",
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
            )}
            {status.label}
          </div>
          <div
            style={{
              fontSize: 11,
              marginTop: 6,
              fontFamily: MONO,
              color: isCritical ? "var(--crit)" : "var(--app-text-3)",
              opacity: isCritical ? 0.7 : 1,
            }}
          >
            {status.markets} · {status.severity}
          </div>
        </div>

        {/* Expected return */}
        <div style={{ ...moduleBase, padding: "16px 18px" }}>
          <div style={kpiLabelBase}>Expected return</div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: "-0.015em",
              color: "var(--app-text)",
              lineHeight: 1.1,
            }}
          >
            {expectedReturn ? expectedReturn.range : "—"}
          </div>
          <div
            style={{
              fontSize: 11,
              marginTop: 6,
              fontFamily: MONO,
              color: "var(--app-text-3)",
            }}
          >
            {expectedReturn ? expectedReturn.label : "no forecast"}
          </div>
        </div>

        {/* AU trade price */}
        <div style={{ ...moduleBase, padding: "16px 18px" }}>
          <div style={kpiLabelBase}>AU trade price</div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: "-0.015em",
              color: "var(--app-text)",
              lineHeight: 1.1,
            }}
          >
            {tradePrice ? tradePrice.au.value : "—"}
          </div>
          <div
            style={{
              fontSize: 11,
              marginTop: 6,
              fontFamily: MONO,
              color: "var(--app-text-3)",
            }}
          >
            {tradePrice
              ? `${tradePrice.au.unit} · updated ${tradePrice.au.updatedDaysAgo}d ago`
              : "no price data"}
          </div>
        </div>

        {/* Top substitute */}
        <div style={{ ...moduleBase, padding: "16px 18px" }}>
          <div style={kpiLabelBase}>Top substitute</div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.015em",
              color: "var(--app-text)",
              lineHeight: 1.1,
            }}
          >
            {topAlternative ? topAlternative.name : "—"}
          </div>
          <div
            style={{
              fontSize: 11,
              marginTop: 6,
              fontFamily: MONO,
              color: "var(--app-text-3)",
            }}
          >
            {topAlternative
              ? `${affinity(topAlternative.matchPercent) ? `${affinity(topAlternative.matchPercent)} · ` : ""}${
                  topAlternative.isAvailable ? "available" : "limited"
                }`
              : "none found"}
          </div>
        </div>
      </div>

      {/* ============== Supply concentration + market context strip ============== */}
      {(manufacturer || marketSpend) && (
        <div
          className="d-strip"
          style={{
            display: "grid",
            gridTemplateColumns: manufacturer && marketSpend ? "1fr 1fr" : "1fr",
            gap: 12,
            marginBottom: 20,
          }}
        >
          {manufacturer && (
            <div style={{ ...moduleBase, padding: "16px 18px" }}>
              <div style={{ ...moduleHead, marginBottom: 10 }}>
                <div style={moduleTitle}>Manufacturer concentration</div>
                <div style={moduleMeta}>
                  PharmaCompass · {manufacturer.count} suppliers
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 14,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 24,
                    fontWeight: 600,
                    color: "var(--app-text)",
                    letterSpacing: "-0.015em",
                  }}
                >
                  {manufacturer.count.toLocaleString()}
                </div>
                <RiskBadge band={manufacturer.band} />
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 14,
                  fontSize: 11,
                  color: "var(--app-text-3)",
                  fontFamily: MONO,
                  marginTop: 8,
                  flexWrap: "wrap",
                }}
              >
                {manufacturer.usdmf !== undefined && (
                  <span><strong style={{ color: "var(--app-text)" }}>{manufacturer.usdmf}</strong> USDMF</span>
                )}
                {manufacturer.cep !== undefined && (
                  <span><strong style={{ color: "var(--app-text)" }}>{manufacturer.cep}</strong> EU CEP</span>
                )}
                {manufacturer.euWc !== undefined && (
                  <span><strong style={{ color: "var(--app-text)" }}>{manufacturer.euWc}</strong> EU WC</span>
                )}
              </div>
            </div>
          )}

          {marketSpend && (
            <div style={{ ...moduleBase, padding: "16px 18px" }}>
              <div style={{ ...moduleHead, marginBottom: 10 }}>
                <div style={moduleTitle}>Market spending baseline</div>
                <div style={moduleMeta}>OECD · {marketSpend.year}</div>
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 24,
                  fontWeight: 600,
                  color: "var(--app-text)",
                  letterSpacing: "-0.015em",
                }}
              >
                ${marketSpend.usdPpp.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                <span style={{ fontSize: 13, color: "var(--app-text-4)", fontWeight: 500 }}>
                  {" "}USD PPP / capita
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--app-text-3)",
                  marginTop: 6,
                  lineHeight: 1.5,
                }}
              >
                {marketSpend.country} pharmaceutical spending per capita ({marketSpend.year}).
                Reference baseline for procurement budgeting.
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============== Modules grid ============== */}
      <div
        className="d-modules"
        style={{
          display: "grid",
          gridTemplateColumns: "1.6fr 1fr",
          gap: 14,
        }}
      >
        {/* ---------- Left column ---------- */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Trade price module */}
          {tradePrice && (
            <div style={moduleBase}>
              <div style={moduleHead}>
                <div style={moduleTitle}>
                  Trade price — AU{" "}
                  {tradePrice.adjacent.length > 0
                    ? `+ ${tradePrice.adjacent.length} adjacent market${
                        tradePrice.adjacent.length === 1 ? "" : "s"
                      }`
                    : ""}
                </div>
                <div style={moduleMeta}>
                  30d median · updated {tradePrice.au.updatedDaysAgo}d ago
                </div>
              </div>
              <div
                className="d-price-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(6, 1fr)",
                  gap: 8,
                }}
              >
                <PriceCell
                  flag="🇦🇺"
                  country="AU"
                  price={tradePrice.au.value}
                  delta={null}
                  home
                />
                {tradePrice.adjacent.map((m) => (
                  <PriceCell
                    key={`${m.country}-${m.price}`}
                    flag={m.flag}
                    country={m.country}
                    price={m.price}
                    delta={m.delta}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Alternatives module */}
          {alternatives.length > 0 && (
            <div style={moduleBase}>
              <div style={moduleHead}>
                <div style={moduleTitle}>
                  Alternatives — ranked by clinical match
                </div>
                <div style={moduleMeta}>
                  {alternatives.length} option
                  {alternatives.length === 1 ? "" : "s"}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {alternatives.map((alt, idx) => {
                  const isFirst = idx === 0;
                  const isLast = idx === alternatives.length - 1;
                  return (
                    <div
                      key={`${alt.name}-${idx}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1.4fr 1fr auto auto",
                        gap: 12,
                        alignItems: "center",
                        padding: isFirst
                          ? "0 0 10px"
                          : isLast
                          ? "10px 0 0"
                          : "10px 0",
                        borderBottom: isLast
                          ? 0
                          : "1px solid var(--app-border)",
                        fontSize: 12,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontWeight: 500,
                            color: "var(--app-text)",
                          }}
                        >
                          {alt.name}
                        </div>
                        <div
                          style={{
                            color: "var(--app-text-3)",
                            fontSize: 11,
                          }}
                        >
                          {alt.form}
                        </div>
                      </div>
                      <div
                        style={{
                          color: "var(--app-text-3)",
                          fontSize: 11,
                          fontFamily: MONO,
                        }}
                      >
                        {alt.priceAud !== undefined && alt.priceAud !== null
                          ? `$${alt.priceAud.toFixed(2)} AUD`
                          : "—"}
                      </div>
                      <div
                        style={{
                          fontFamily: MONO,
                          color: "var(--app-text-2)",
                          fontSize: 11,
                          fontWeight: 500,
                        }}
                      >
                        {affinity(alt.matchPercent) ?? "listed alternative"}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          padding: "3px 7px",
                          borderRadius: 4,
                          fontWeight: 500,
                          background: alt.isAvailable
                            ? "var(--low-bg)"
                            : "var(--med-bg)",
                          color: alt.isAvailable
                            ? "var(--low)"
                            : "var(--med)",
                          border: `1px solid ${
                            alt.isAvailable ? "var(--low-b)" : "var(--med-b)"
                          }`,
                        }}
                      >
                        {alt.isAvailable ? "Available" : "Limited"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ---------- Right sidebar ---------- */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Confidence module — hidden until a real confidence metric exists
              (the fabricated AI-forecast score was removed). */}
          {expectedReturn && expectedReturn.confidence > 0 && (
            <div style={{ ...moduleBase, padding: "16px 18px" }}>
              <div style={moduleHead}>
                <div style={moduleTitle}>Confidence</div>
                <div style={moduleMeta}>AI return forecast</div>
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 22,
                  fontWeight: 600,
                  color: "var(--app-text)",
                }}
              >
                {expectedReturn.confidence}
                <span style={{ fontSize: 13, color: "var(--app-text-4)" }}>
                  {" "}
                  / 100
                </span>
              </div>
              <div
                style={{
                  height: 5,
                  background: "var(--app-bg-2)",
                  borderRadius: 3,
                  overflow: "hidden",
                  marginTop: 10,
                }}
              >
                <div
                  style={{
                    width: `${confidencePct}%`,
                    height: "100%",
                    background: "var(--teal)",
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--app-text-3)",
                  marginTop: 10,
                  lineHeight: 1.5,
                }}
              >
                {expectedReturn.label} · range {expectedReturn.range}
              </div>
            </div>
          )}

          {/* Shortage details */}
          {hasShortageRows && shortageDetails && (
            <div style={{ ...moduleBase, padding: "16px 18px" }}>
              <div style={moduleHead}>
                <div style={moduleTitle}>Shortage details</div>
              </div>
              {shortageDetails.reason && (
                <StatRow label="Reason" value={shortageDetails.reason} />
              )}
              {shortageDetails.firstReported && (
                <StatRow
                  label="First reported"
                  value={shortageDetails.firstReported}
                />
              )}
              {shortageDetails.sourcesCount !== undefined && (
                <StatRow
                  label="Sources"
                  value={`${shortageDetails.sourcesCount} regulator${
                    shortageDetails.sourcesCount === 1 ? "" : "s"
                  }`}
                />
              )}
              {shortageDetails.priorIncidents !== undefined && (
                <StatRow
                  label="Prior incidents"
                  value={`${shortageDetails.priorIncidents} on record`}
                  isLast
                />
              )}
            </div>
          )}

          {/* Dark "Get notified" alert card */}
          <div
            style={{
              background: "var(--app-text)",
              borderRadius: 10,
              padding: 16,
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#fff",
                marginBottom: 4,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Bell size={13} /> Get notified
            </div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.65)",
                marginBottom: 12,
                lineHeight: 1.5,
              }}
            >
              We&rsquo;ll email + SMS you the moment any AU supplier lists
              stock.
            </div>
            <a
              href="/alerts"
              style={{
                width: "100%",
                padding: 10,
                background: "var(--teal)",
                border: 0,
                borderRadius: 7,
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "var(--font-inter), sans-serif",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                textDecoration: "none",
                boxSizing: "border-box",
              }}
            >
              Subscribe to alert
            </a>
          </div>
        </div>
      </div>

      {/* ---------- responsive + animation ---------- */}
      <style>{`
        .pv-blink { animation: pv-blink 1.6s ease-in-out infinite; }
        @keyframes pv-blink {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.35; }
        }
        @media (max-width: 768px) {
          .d-kpis  { grid-template-columns: repeat(2, 1fr) !important; }
          .d-modules { grid-template-columns: 1fr !important; }
          .d-strip   { grid-template-columns: 1fr !important; }
          .d-price-grid { grid-template-columns: repeat(3, 1fr) !important; }
        }
      `}</style>
    </section>
  );
}

/* ---------- helpers ---------- */

function PriceCell({
  flag,
  country,
  price,
  delta,
  home = false,
}: {
  flag: string;
  country: string;
  price: string;
  delta: number | null;
  home?: boolean;
}) {
  const deltaColor =
    delta === null
      ? "var(--app-text-4)"
      : delta > 0
      ? "var(--crit)"
      : delta < 0
      ? "var(--low)"
      : "var(--app-text-4)";

  return (
    <div
      style={{
        padding: "11px 12px",
        background: home ? "var(--teal-bg)" : "var(--app-bg-2)",
        border: `1px solid ${home ? "var(--teal-b)" : "var(--app-border)"}`,
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          fontSize: 11,
          color: home ? "var(--teal)" : "var(--app-text-3)",
          fontWeight: home ? 600 : 400,
        }}
      >
        <span style={{ fontSize: 13, lineHeight: 1 }}>{flag}</span>
        {country}
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 14,
          fontWeight: 600,
          color: home ? "var(--teal)" : "var(--app-text)",
        }}
      >
        {price}
      </div>
      <div
        style={{
          fontSize: 10,
          fontFamily: MONO,
          color: deltaColor,
        }}
      >
        {delta === null
          ? "home"
          : delta === 0
          ? "flat"
          : `${delta > 0 ? "+" : ""}${delta}%`}
      </div>
    </div>
  );
}

function RiskBadge({ band }: { band: "unknown" | "high_risk" | "moderate_risk" | "low_risk" }) {
  const palette: Record<typeof band, { label: string; c: string; bg: string; b: string }> = {
    high_risk:     { label: "High concentration risk",     c: "var(--crit)", bg: "var(--crit-bg)", b: "var(--crit-b)" },
    moderate_risk: { label: "Moderate concentration risk", c: "var(--med)",  bg: "var(--med-bg)",  b: "var(--med-b)"  },
    low_risk:      { label: "Diverse supplier base",       c: "var(--low)",  bg: "var(--low-bg)",  b: "var(--low-b)"  },
    unknown:       { label: "Concentration unknown",       c: "var(--app-text-4)", bg: "var(--app-bg-2)", b: "var(--app-border)" },
  };
  const s = palette[band];
  return (
    <span
      style={{
        fontSize: 10,
        padding: "4px 9px",
        borderRadius: 5,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        fontFamily: "var(--font-dm-mono), monospace",
        background: s.bg,
        color: s.c,
        border: `1px solid ${s.b}`,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

function StatRow({
  label,
  value,
  isLast = false,
}: {
  label: string;
  value: string;
  isLast?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        padding: "8px 0",
        borderBottom: isLast ? 0 : "1px solid var(--app-border)",
        fontSize: 12,
      }}
    >
      <span style={{ color: "var(--app-text-3)" }}>{label}</span>
      <span
        style={{
          color: "var(--app-text)",
          fontFamily: MONO,
          fontWeight: 500,
        }}
      >
        {value}
      </span>
    </div>
  );
}