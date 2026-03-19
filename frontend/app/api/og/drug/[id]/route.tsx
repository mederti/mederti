import { ImageResponse } from "next/og";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "edge";

const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia", US: "United States", GB: "United Kingdom", CA: "Canada",
  DE: "Germany", FR: "France", IT: "Italy", ES: "Spain", EU: "EU",
  NZ: "New Zealand", SG: "Singapore", IE: "Ireland", NO: "Norway",
  FI: "Finland", CH: "Switzerland", SE: "Sweden", AT: "Austria",
  BE: "Belgium", NL: "Netherlands", JP: "Japan",
};

function sevBadge(severity: string) {
  const s = severity.toLowerCase();
  if (s === "critical") return { bg: "#dc2626", text: "#fff", label: "CRITICAL" };
  if (s === "high") return { bg: "#d97706", text: "#fff", label: "HIGH" };
  return { bg: "#0F172A", text: "#fff", label: "ACTIVE" };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const [drugRes, shortagesRes] = await Promise.allSettled([
    supabase.from("drugs").select("generic_name, strengths").eq("id", id).single(),
    supabase
      .from("shortage_events")
      .select("country_code, severity")
      .eq("drug_id", id)
      .in("status", ["active", "anticipated"]),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drug = drugRes.status === "fulfilled" ? (drugRes.value as any).data : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shortages = shortagesRes.status === "fulfilled" ? ((shortagesRes.value as any).data ?? []) : [];

  const name = drug?.generic_name ?? id.replace(/-/g, " ");
  const strength = drug?.strengths?.[0] ?? "";

  const countries: string[] = [...new Set(shortages.map((s: { country_code: string }) => s.country_code).filter(Boolean) as string[])];
  const countryNames = countries.slice(0, 5).map((c) => COUNTRY_NAMES[c] ?? c);

  const worstSeverity = shortages.reduce(
    (worst: string, s: { severity: string | null }) => {
      const sev = s.severity?.toLowerCase() ?? "";
      if (sev === "critical") return "critical";
      if (sev === "high" && worst !== "critical") return "high";
      if (worst === "none") return sev || worst;
      return worst;
    },
    "none",
  );

  const badge = worstSeverity !== "none" ? sevBadge(worstSeverity) : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0f172a",
          padding: "56px 64px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Top: logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "#0F172A",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              fontWeight: 800,
              color: "#fff",
            }}
          >
            M
          </div>
          <span style={{ fontSize: 28, fontWeight: 700, color: "#94a3b8" }}>
            mederti
          </span>
        </div>

        {/* Middle: drug name + badge */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 52,
                fontWeight: 800,
                color: "#fff",
                lineHeight: 1.1,
                letterSpacing: "-0.02em",
              }}
            >
              {name}
            </span>
            {badge && (
              <div
                style={{
                  padding: "8px 20px",
                  borderRadius: 8,
                  background: badge.bg,
                  color: badge.text,
                  fontSize: 20,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                }}
              >
                {badge.label}
              </div>
            )}
          </div>

          {strength && (
            <span style={{ fontSize: 28, color: "#94a3b8", fontWeight: 500 }}>
              {strength}
            </span>
          )}

          {countries.length > 0 && (
            <span style={{ fontSize: 22, color: "#5eead4", fontWeight: 500 }}>
              {shortages.length} shortage{shortages.length !== 1 ? "s" : ""} across{" "}
              {countries.length} {countries.length === 1 ? "country" : "countries"}
              {countryNames.length > 0 ? ` — ${countryNames.join(", ")}` : ""}
            </span>
          )}

          {countries.length === 0 && (
            <span style={{ fontSize: 22, color: "#16a34a", fontWeight: 500 }}>
              No active shortages
            </span>
          )}
        </div>

        {/* Bottom: domain */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 20, color: "#64748b", fontWeight: 500 }}>
            mederti.com
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
