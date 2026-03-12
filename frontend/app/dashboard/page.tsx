export const dynamic = "force-dynamic";

import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";
import SituationBanner from "./SituationBanner";
import ShortageAlerts from "./ShortageAlerts";
import MedicineSearch from "./MedicineSearch";
import CriticalWatchlist from "./CriticalWatchlist";

export default function DashboardPage() {
  return (
    <div
      style={{
        background: "#f8fafc",
        minHeight: "100vh",
        color: "#0f172a",
        fontFamily: "var(--font-inter), sans-serif",
      }}
    >
      <SiteNav />

      {/* Header */}
      <div
        style={{
          background: "#fff",
          borderBottom: "1px solid #e2e8f0",
          padding: "28px 24px 24px",
        }}
      >
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <h1
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: "#0f172a",
                  margin: "0 0 4px",
                  letterSpacing: "-0.01em",
                }}
              >
                Operational Dashboard
              </h1>
              <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>
                Real-time pharmaceutical shortage intelligence across global
                regulatory sources.
              </p>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "#94a3b8",
                fontFamily: "var(--font-dm-mono), monospace",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#16a34a",
                  display: "inline-block",
                }}
              />
              Live
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div
        style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 48px" }}
      >
        {/* 1. Global Situation Banner */}
        <section style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#94a3b8",
              marginBottom: 10,
            }}
          >
            Global Situation
          </div>
          <SituationBanner />
        </section>

        {/* Two-column layout: Alerts + Search */}
        <div
          className="db-two-col"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
            marginBottom: 20,
          }}
        >
          {/* 2. Shortage Alerts */}
          <section>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "#94a3b8",
                marginBottom: 10,
              }}
            >
              Alerts
            </div>
            <ShortageAlerts />
          </section>

          {/* 3. Medicine Search */}
          <section>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "#94a3b8",
                marginBottom: 10,
              }}
            >
              Search
            </div>
            <MedicineSearch />
          </section>
        </div>

        {/* 4. Critical Medicines Watchlist */}
        <section style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#94a3b8",
              marginBottom: 10,
            }}
          >
            Watchlist
          </div>
          <CriticalWatchlist />
        </section>
      </div>

      <SiteFooter />

      {/* Responsive styles */}
      <style>{`
        @media (max-width: 768px) {
          .db-two-col { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
