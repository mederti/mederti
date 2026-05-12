import { ImageResponse } from "next/og";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "edge";

// ─── Country labels + flags ─────────────────────────────────────────────────
const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia", US: "United States", GB: "United Kingdom", CA: "Canada",
  DE: "Germany", FR: "France", IT: "Italy", ES: "Spain", EU: "EU",
  NZ: "New Zealand", SG: "Singapore", IE: "Ireland", NO: "Norway",
  FI: "Finland", CH: "Switzerland", SE: "Sweden", AT: "Austria",
  BE: "Belgium", NL: "Netherlands", JP: "Japan", IN: "India", AE: "UAE",
};

const FLAGS: Record<string, string> = {
  AU: "🇦🇺", US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹",
  ES: "🇪🇸", EU: "🇪🇺", NZ: "🇳🇿", SG: "🇸🇬", IE: "🇮🇪", NO: "🇳🇴", FI: "🇫🇮",
  CH: "🇨🇭", SE: "🇸🇪", AT: "🇦🇹", BE: "🇧🇪", NL: "🇳🇱", JP: "🇯🇵", IN: "🇮🇳",
  AE: "🇦🇪",
};

// Severity → styling
function sevBadge(severity: string): { bg: string; text: string; label: string } {
  const s = severity.toLowerCase();
  if (s === "critical") return { bg: "#dc2626", text: "#fff", label: "Critical shortage" };
  if (s === "high")     return { bg: "#ea580c", text: "#fff", label: "High shortage" };
  if (s === "medium")   return { bg: "#f59e0b", text: "#0f172a", label: "Medium shortage" };
  if (s === "low")      return { bg: "#3b82f6", text: "#fff", label: "Low shortage" };
  return                       { bg: "#0F172A", text: "#fff", label: "Shortage active" };
}

function worstSeverityOf(shortages: Array<{ severity: string | null }>): string {
  const order = ["critical", "high", "medium", "low"];
  for (const o of order) {
    if (shortages.some((s) => (s.severity ?? "").toLowerCase() === o)) return o;
  }
  return "none";
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const [drugRes, shortagesRes, catalogueRes] = await Promise.allSettled([
    supabase
      .from("drugs")
      .select("generic_name, atc_code, atc_description, strengths, drug_class, who_essential_medicine")
      .eq("id", id)
      .single(),
    supabase
      .from("shortage_events")
      .select("country_code, severity")
      .eq("drug_id", id)
      .in("status", ["active", "anticipated"]),
    supabase
      .from("drug_catalogue")
      .select("source_country")
      .eq("drug_id", id)
      .limit(1000),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drug = drugRes.status === "fulfilled" ? (drugRes.value as any).data : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shortages = shortagesRes.status === "fulfilled" ? ((shortagesRes.value as any).data ?? []) : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const catalogue = catalogueRes.status === "fulfilled" ? ((catalogueRes.value as any).data ?? []) : [];

  const name: string = drug?.generic_name ?? id.replace(/-/g, " ");
  const atcCode: string | null = drug?.atc_code ?? null;
  const drugClass: string | null = drug?.drug_class ?? drug?.atc_description ?? null;
  const isEssential: boolean = !!drug?.who_essential_medicine;

  const shortageCountries: string[] = Array.from(
    new Set(shortages.map((s: { country_code: string }) => s.country_code).filter(Boolean) as string[])
  );
  const cataCountries: string[] = Array.from(
    new Set(catalogue.map((c: { source_country: string }) => c.source_country).filter(Boolean) as string[])
  );

  const worst = worstSeverityOf(shortages as Array<{ severity: string | null }>);
  const hasShortage = worst !== "none";
  const badge = hasShortage ? sevBadge(worst) : null;

  // Truncate drug name for display
  const displayName = name.length > 38 ? name.slice(0, 36) + "…" : name;
  const titleSize = displayName.length > 26 ? 64 : displayName.length > 18 ? 76 : 92;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#0b1220",
          padding: "56px 64px",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* Decorative teal accent strip */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 6,
            background: hasShortage ? "#dc2626" : "#10b981",
            display: "flex",
          }}
        />

        {/* Top row: brand + status pill */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 40, height: 40, borderRadius: 10,
                background: "#10b981",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, fontWeight: 800, color: "#0b1220",
              }}
            >
              M
            </div>
            <span style={{ fontSize: 26, fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.01em" }}>
              mederti
            </span>
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: "0.18em",
              textTransform: "uppercase", color: "#94a3b8",
              marginLeft: 14, paddingLeft: 14,
              borderLeft: "1px solid #334155",
              display: "flex",
            }}>
              Pharma intelligence
            </span>
          </div>

          {/* Status pill */}
          {hasShortage && badge ? (
            <div
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 18px",
                background: badge.bg, color: badge.text,
                borderRadius: 999,
                fontSize: 18, fontWeight: 700, letterSpacing: "0.02em",
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: 999, background: badge.text, display: "flex" }} />
              {badge.label}
            </div>
          ) : (
            <div
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 18px",
                background: "rgba(16, 185, 129, 0.12)", color: "#34d399",
                borderRadius: 999,
                fontSize: 17, fontWeight: 600,
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: 999, background: "#34d399", display: "flex" }} />
              In normal supply
            </div>
          )}
        </div>

        {/* Middle: drug name + sub-info */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: 56, flexGrow: 1, justifyContent: "center" }}>
          <span
            style={{
              fontSize: titleSize,
              fontWeight: 800,
              color: "#fff",
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              display: "flex",
            }}
          >
            {displayName}
          </span>

          {/* Meta row: ATC + class + WHO essential */}
          {(atcCode || drugClass || isEssential) && (
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 18, flexWrap: "wrap" }}>
              {atcCode && (
                <span style={{
                  fontSize: 18, fontWeight: 600, color: "#94a3b8",
                  fontFamily: "monospace",
                  padding: "5px 12px",
                  border: "1px solid #334155",
                  borderRadius: 6,
                  display: "flex",
                }}>
                  ATC · {atcCode}
                </span>
              )}
              {drugClass && (
                <span style={{ fontSize: 20, color: "#cbd5e1", fontWeight: 500, display: "flex" }}>
                  {drugClass.length > 50 ? drugClass.slice(0, 48) + "…" : drugClass}
                </span>
              )}
              {isEssential && (
                <span style={{
                  fontSize: 14, fontWeight: 700, letterSpacing: "0.08em",
                  textTransform: "uppercase", color: "#10b981",
                  padding: "4px 10px",
                  background: "rgba(16, 185, 129, 0.12)",
                  borderRadius: 4,
                  display: "flex",
                }}>
                  WHO Essential
                </span>
              )}
            </div>
          )}
        </div>

        {/* Bottom: stats row + domain */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          {/* Left: shortage / availability stats */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {hasShortage && shortageCountries.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#94a3b8", display: "flex" }}>
                  Shortage in {shortageCountries.length} {shortageCountries.length === 1 ? "country" : "countries"}
                </span>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {shortageCountries.slice(0, 6).map((c) => (
                    <span
                      key={c}
                      style={{
                        fontSize: 28,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: 38, height: 38,
                        background: "#1e293b", borderRadius: 6,
                      }}
                    >
                      {FLAGS[c] ?? c}
                    </span>
                  ))}
                  {shortageCountries.length > 6 && (
                    <span style={{ fontSize: 18, color: "#94a3b8", fontWeight: 600, marginLeft: 4, display: "flex" }}>
                      +{shortageCountries.length - 6}
                    </span>
                  )}
                </div>
              </div>
            )}

            {!hasShortage && cataCountries.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#94a3b8", display: "flex" }}>
                  Registered in {cataCountries.length} {cataCountries.length === 1 ? "country" : "countries"}
                </span>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {cataCountries.slice(0, 6).map((c) => (
                    <span
                      key={c}
                      style={{
                        fontSize: 28,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: 38, height: 38,
                        background: "#1e293b", borderRadius: 6,
                      }}
                    >
                      {FLAGS[c] ?? c}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: attribution */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#475569", display: "flex" }}>
              Tracked from 47 sources
            </span>
            <span style={{ fontSize: 22, fontWeight: 700, color: "#cbd5e1", display: "flex" }}>
              mederti.com
            </span>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
