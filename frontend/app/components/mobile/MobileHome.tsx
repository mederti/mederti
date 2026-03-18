import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { BottomNav } from "./BottomNav";

export async function MobileHome() {
  // Fetch critical shortages for AU
  let criticalShortages: { id: string; drug_name: string; severity: string; shortage_status: string }[] = [];
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from("shortage_events")
      .select("id, drug_name, severity, shortage_status")
      .eq("source_country", "AU")
      .in("shortage_status", ["active", "current"])
      .in("severity", ["critical", "high"])
      .order("severity", { ascending: true })
      .limit(5);
    if (data) criticalShortages = data;
  } catch { /* fallback empty */ }

  return (
    <div style={{
      maxWidth: 480, margin: "0 auto", minHeight: "100dvh",
      display: "flex", flexDirection: "column",
      background: "var(--app-bg)", position: "relative",
    }}>
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 60 }}>
        <div style={{ padding: "16px 16px 0" }}>
          {/* Logo */}
          <div style={{ fontSize: 16, fontWeight: 600, color: "#0d9488", marginBottom: 16 }}>
            mederti
          </div>

          {/* Search bar — tappable, goes to /search */}
          <a href="/search" style={{ textDecoration: "none" }}>
            <div style={{
              background: "var(--app-bg-2)",
              border: "1px solid var(--app-border)",
              borderRadius: 24,
              padding: "10px 16px",
              display: "flex", alignItems: "center", gap: 10,
              marginBottom: 20,
            }}>
              <svg width="16" height="16" fill="none" stroke="var(--app-text-4)" strokeWidth="1.5" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <span style={{ fontSize: 14, color: "var(--app-text-4)" }}>Search any drug...</span>
            </div>
          </a>

          {/* Critical shortages in AU */}
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-4)", marginBottom: 10 }}>
            Critical shortages &middot; AU
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {criticalShortages.length > 0 ? criticalShortages.map(s => (
              <a key={s.id} href={`/drugs/${s.id}`} style={{ textDecoration: "none" }}>
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 14px",
                  background: "var(--app-bg)",
                  border: "1px solid var(--app-border)",
                  borderRadius: 10,
                }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "var(--app-text)" }}>{s.drug_name}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 500,
                    color: s.severity === "critical" ? "var(--crit)" : "var(--high)",
                  }}>
                    {s.severity === "critical" ? "Critical" : "High"}
                  </span>
                </div>
              </a>
            )) : (
              <div style={{ fontSize: 13, color: "var(--app-text-4)", padding: "10px 0" }}>
                No critical shortages reported
              </div>
            )}
          </div>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
