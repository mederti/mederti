"use client";
import { useState } from "react";
import { MobileSupplierPage } from "./MobileSupplierPage";
import { BottomNav } from "./BottomNav";
import { V4BellButton } from "@/app/drugs/[id]/v4/bell-button";
import type { SupplierPartner } from "@/lib/suppliers";
import { detectS19A, getS19AText } from "@/lib/shortage-utils";

const SEV_ORDER = ["critical", "high", "medium", "low"] as const;

const COUNTRY_FLAGS: Record<string, string> = {
  AU: "\u{1F1E6}\u{1F1FA}", US: "\u{1F1FA}\u{1F1F8}", GB: "\u{1F1EC}\u{1F1E7}", CA: "\u{1F1E8}\u{1F1E6}",
  DE: "\u{1F1E9}\u{1F1EA}", FR: "\u{1F1EB}\u{1F1F7}", IT: "\u{1F1EE}\u{1F1F9}", NO: "\u{1F1F3}\u{1F1F4}",
  CH: "\u{1F1E8}\u{1F1ED}", SG: "\u{1F1F8}\u{1F1EC}", NZ: "\u{1F1F3}\u{1F1FF}", ES: "\u{1F1EA}\u{1F1F8}",
  IE: "\u{1F1EE}\u{1F1EA}", FI: "\u{1F1EB}\u{1F1EE}", SE: "\u{1F1F8}\u{1F1EA}", EU: "\u{1F1EA}\u{1F1FA}",
};

const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia", US: "United States", GB: "United Kingdom", CA: "Canada",
  DE: "Germany", FR: "France", IT: "Italy", ES: "Spain", EU: "EU",
  NZ: "New Zealand", SG: "Singapore", IE: "Ireland", NO: "Norway",
  FI: "Finland", CH: "Switzerland", SE: "Sweden",
};

function sevLabel(sev: string): string {
  const s = sev.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1) + " shortage";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface MobileDrugPageProps {
  drug: {
    id: string;
    generic_name: string;
    brand_names?: string[] | null;
    strengths?: string[] | null;
    dosage_forms?: string[] | null;
    ai_insight?: string | null;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  activeShortages: any[];
  userCountry: string;
  partner: SupplierPartner | null;
  drugStrength: string;
  predictedReturnDate: string | null;
  confidence: number;
}

export function MobileDrugPage({
  drug, activeShortages, userCountry, partner, drugStrength, predictedReturnDate, confidence,
}: MobileDrugPageProps) {
  const [showSupplier, setShowSupplier] = useState(false);

  const countryEvents = activeShortages.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => (e.country_code ?? "").toUpperCase() === userCountry
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const worstEvent = countryEvents.reduce((worst: any, s: any) => {
    const si = SEV_ORDER.indexOf((s.severity ?? "low").toLowerCase() as typeof SEV_ORDER[number]);
    const wi = SEV_ORDER.indexOf((worst?.severity ?? "low").toLowerCase() as typeof SEV_ORDER[number]);
    return si >= 0 && si < wi ? s : worst;
  }, countryEvents[0] ?? null);

  const hasShortage = !!worstEvent;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s19aEvent = countryEvents.find((e: any) => detectS19A(e.notes));
  const s19aText = s19aEvent ? getS19AText(s19aEvent.notes) : null;
  const mySev = (worstEvent?.severity ?? "medium").toLowerCase();
  const statusLabel = hasShortage ? sevLabel(mySev) : "In supply";

  // Other countries — deduplicated
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const otherCountries: [string, any][] = [];
  const seen = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const e of activeShortages as any[]) {
    const cc = (e.country_code ?? "").toUpperCase();
    if (cc === userCountry || seen.has(cc)) continue;
    seen.add(cc);
    otherCountries.push([cc, e]);
  }

  const flag = COUNTRY_FLAGS[userCountry] ?? "\u{1F30D}";

  if (showSupplier && partner) {
    return (
      <MobileSupplierPage
        partner={partner}
        drugName={`${drug.generic_name} ${drugStrength}`.trim()}
        drugId={drug.id}
        severity={mySev}
        userCountry={userCountry}
        onBack={() => setShowSupplier(false)}
      />
    );
  }

  return (
    <div style={{
      maxWidth: 480, margin: "0 auto", minHeight: "100dvh",
      display: "flex", flexDirection: "column",
      background: "var(--app-bg)", position: "relative",
    }}>
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 60 }}>
        {/* Header */}
        <div style={{ padding: "12px 16px 10px", borderBottom: "1px solid var(--app-border)" }}>
          <a href="/search" style={{ fontSize: 11, color: "var(--app-text-4)", textDecoration: "none" }}>
            &larr; Search results
          </a>
          <div style={{ fontSize: 20, fontWeight: 600, color: "var(--app-text)", marginTop: 6, letterSpacing: "-0.02em" }}>
            {drug.generic_name}{" "}
            <span style={{ fontWeight: 400, color: "var(--app-text-3)", fontSize: 16 }}>{drugStrength}</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--app-text-4)", marginTop: 2 }}>
            {drug.brand_names?.[0] ? `${drug.brand_names[0]} \u00b7 ` : ""}Updated recently
          </div>
        </div>

        {/* Country status card */}
        {hasShortage ? (
          <div style={{
            margin: "12px 16px",
            background: mySev === "critical" ? "var(--crit-bg)" : mySev === "high" ? "var(--high-bg)" : "var(--med-bg)",
            border: `1px solid ${mySev === "critical" ? "var(--crit-b)" : mySev === "high" ? "var(--high-b)" : "var(--med-b)"}`,
            borderRadius: 14, padding: "14px 16px",
          }}>
            <div style={{
              fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em",
              color: mySev === "critical" ? "var(--crit)" : mySev === "high" ? "var(--high)" : "var(--med)",
              marginBottom: 4,
            }}>
              {flag} {userCountry} &middot; Now
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, color: "var(--app-text)", marginBottom: 2 }}>
              {statusLabel}
            </div>
            <div style={{ fontSize: 12, color: "var(--app-text-3)", marginBottom: 10 }}>
              {worstEvent?.reason?.replace(/^availability:\s*/i, "") ?? "Supply disruption"}
            </div>
            <div style={{
              height: 1, marginBottom: 10,
              background: mySev === "critical" ? "var(--crit-b)" : mySev === "high" ? "var(--high-b)" : "var(--med-b)",
            }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
              <div>
                <div style={{
                  fontSize: 9, textTransform: "uppercase", letterSpacing: "0.07em",
                  color: mySev === "critical" ? "var(--crit)" : mySev === "high" ? "var(--high)" : "var(--med)",
                  marginBottom: 2,
                }}>
                  Predicted return
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--app-text)" }}>
                  {predictedReturnDate ?? "Unknown"}
                </div>
              </div>
              {confidence > 0 && (
                <div style={{
                  fontSize: 11, fontFamily: "monospace",
                  color: mySev === "critical" ? "var(--crit)" : mySev === "high" ? "var(--high)" : "var(--med)",
                }}>
                  {confidence} / 100
                </div>
              )}
            </div>

            {/* S19A approval badge */}
            {s19aText && (
              <div style={{
                marginTop: 12,
                background: "var(--ind-bg)",
                border: "1px solid var(--ind-b)",
                borderRadius: 10,
                padding: "10px 14px",
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: "0.08em",
                  color: "var(--indigo)", flexShrink: 0, marginTop: 1,
                }}>
                  S19A
                </div>
                <div style={{ fontSize: 12, color: "var(--app-text-2)", lineHeight: 1.6 }}>
                  {s19aText}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{
            margin: "12px 16px", background: "var(--low-bg)",
            border: "1px solid var(--low-b)", borderRadius: 14, padding: "14px 16px",
          }}>
            <div style={{
              fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em",
              color: "var(--low)", marginBottom: 4,
            }}>
              {flag} {userCountry} &middot; Now
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, color: "var(--app-text)" }}>In supply</div>
            <div style={{ fontSize: 12, color: "var(--app-text-3)", marginTop: 2 }}>No shortage reported</div>
          </div>
        )}

        {/* Other countries — horizontal scroll */}
        {otherCountries.length > 0 && (
          <>
            <div style={{
              padding: "0 16px 8px", fontSize: 10, fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-4)",
            }}>
              Other countries
            </div>
            <div style={{
              display: "flex", gap: 6, padding: "0 16px 12px",
              overflowX: "auto", scrollbarWidth: "none",
              WebkitOverflowScrolling: "touch",
            }}>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {otherCountries.slice(0, 8).map(([cc, event]: [string, any]) => {
                const s = (event.severity ?? "medium").toLowerCase();
                return (
                  <div key={cc} style={{
                    flexShrink: 0, padding: "5px 10px", borderRadius: 20,
                    border: "1px solid var(--app-border)", background: "var(--app-bg)",
                    display: "flex", alignItems: "center", gap: 5,
                  }}>
                    <span style={{ fontSize: 12 }}>{COUNTRY_FLAGS[cc] ?? "\u{1F30D}"}</span>
                    <span style={{ fontSize: 10, color: "var(--app-text-3)", whiteSpace: "nowrap" }}>
                      {COUNTRY_NAMES[cc] ?? cc} &middot; {s.charAt(0).toUpperCase() + s.slice(1)}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, padding: "0 16px 16px" }}>
          {partner && (
            <button
              onClick={() => setShowSupplier(true)}
              style={{
                flex: 2, padding: "10px 0", borderRadius: 10,
                background: "var(--teal)", border: "none", color: "#fff",
                fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "Inter, sans-serif",
              }}
            >
              Find supplier
            </button>
          )}
          <a
            href={`/drugs/${drug.id}`}
            style={{
              flex: 1, padding: "10px 0", borderRadius: 10,
              border: "1px solid var(--app-border)", background: "var(--app-bg)",
              fontSize: 13, color: "var(--app-text-3)", textAlign: "center",
              textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            Full detail
          </a>
          <div style={{ position: "relative", width: 42, height: 42, flexShrink: 0 }}>
            <V4BellButton drugId={drug.id} hasShortage={hasShortage} />
          </div>
        </div>

        {/* AI insight */}
        <div style={{
          margin: "0 16px", background: "var(--ind-bg)",
          border: "1px solid var(--ind-b)", borderRadius: 12, padding: "12px 14px",
        }}>
          <div style={{
            fontSize: 10, fontWeight: 600, textTransform: "uppercase",
            letterSpacing: "0.08em", color: "var(--indigo)", marginBottom: 6,
          }}>
            AI insight
          </div>
          <div style={{ fontSize: 12, color: "var(--app-text-2)", lineHeight: 1.6 }}>
            {drug.ai_insight ??
              "Supply disruptions of this type typically persist 3\u20139 months based on historical patterns. Consider therapeutic alternatives where clinically appropriate."}
          </div>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
