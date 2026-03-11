import Link from "next/link";
import type { Metadata } from "next";
import SiteNav from "@/app/components/landing-nav";

export const metadata: Metadata = {
  title: "About — Mederti",
  description: "Mederti aggregates pharmaceutical shortage data from 20+ regulatory bodies worldwide to help clinicians and procurement teams act before supply chains fail.",
};

const SOURCES = [
  { code: "US", name: "FDA", full: "U.S. Food & Drug Administration" },
  { code: "AU", name: "TGA", full: "Therapeutic Goods Administration" },
  { code: "CA", name: "Health Canada", full: "Health Canada Drug Shortages DB" },
  { code: "GB", name: "MHRA", full: "Medicines & Healthcare Regulatory Agency" },
  { code: "EU", name: "EMA", full: "European Medicines Agency" },
  { code: "DE", name: "BfArM", full: "Bundesinstitut für Arzneimittel" },
  { code: "FR", name: "ANSM", full: "Agence nationale de sécurité du médicament" },
  { code: "IT", name: "AIFA", full: "Agenzia Italiana del Farmaco" },
  { code: "ES", name: "AEMPS", full: "Agencia Española de Medicamentos" },
  { code: "FI", name: "Fimea", full: "Finnish Medicines Agency" },
  { code: "NZ", name: "Pharmac", full: "Pharmac New Zealand" },
  { code: "SG", name: "HSA", full: "Health Sciences Authority" },
];

const STATS = [
  { n: "6,000+", label: "Active shortage events" },
  { n: "12", label: "Regulatory bodies indexed" },
  { n: "20+", label: "Countries covered" },
  { n: "6h", label: "Typical data refresh" },
];

const HOW = [
  {
    step: "01",
    title: "Aggregate",
    body: "Automated scrapers run every 6–12 hours against 12 live regulatory databases — FDA, TGA, Health Canada, EMA, MHRA, and more. Raw shortage notices are pulled directly from official sources.",
  },
  {
    step: "02",
    title: "Normalise",
    body: "Each record is deduplicated via a deterministic ID, drug names are resolved against an international drug registry, severity is standardised to a four-tier scale, and reason categories are mapped to a consistent taxonomy.",
  },
  {
    step: "03",
    title: "Surface",
    body: "Clinicians and procurement teams get a single view across all sources — searchable by drug name, filterable by country and severity, with therapeutic alternatives and watchlist alerts built in.",
  },
];

export default function AboutPage() {
  return (
    <div style={{ background: "var(--panel)", minHeight: "100vh", color: "var(--app-text)", fontFamily: "var(--font-inter), sans-serif" }}>
      <style>{`
        @media (max-width: 768px) {
          .about-hero { padding: 100px 20px 60px !important; }
          .about-section { padding: 60px 20px !important; }
          .about-how-grid { grid-template-columns: 1fr !important; }
          .about-stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .about-sources-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .about-footer { padding: 24px 20px !important; flex-direction: column !important; gap: 12px !important; text-align: center !important; }
          .about-footer-links { justify-content: center !important; }
        }
      `}</style>

      <SiteNav />

      {/* HERO */}
      <section className="about-hero" style={{ padding: "96px 48px 80px", borderBottom: "1px solid var(--app-border)", background: "var(--app-bg)" }}>
        <div style={{ maxWidth: 720 }}>
          <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 16 }}>
            About Mederti
          </div>
          <h1 style={{ fontSize: "clamp(32px,5vw,60px)", fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.03em", color: "var(--app-text)", marginBottom: 24, marginTop: 0 }}>
            Intelligence at the edge<br />of the supply chain.
          </h1>
          <p style={{ fontSize: 18, color: "var(--app-text-3)", lineHeight: 1.7, maxWidth: 600, margin: 0 }}>
            Mederti was built because pharmaceutical shortages kill people — and most of the
            information that would help is already public, just scattered across twenty
            different regulatory websites in twelve languages.
          </p>
        </div>
      </section>

      {/* STATS */}
      <section className="about-section" style={{ padding: "0", borderBottom: "1px solid var(--app-border)" }}>
        <div className="about-stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)" }}>
          {STATS.map((s, i) => (
            <div key={s.label} style={{
              padding: "40px 40px", borderRight: i < 3 ? "1px solid var(--app-border)" : "none",
            }}>
              <div style={{ fontSize: 44, fontWeight: 700, color: "var(--app-text)", lineHeight: 1, letterSpacing: "-0.03em", marginBottom: 8 }}>
                {s.n}
              </div>
              <div style={{ fontSize: 14, color: "var(--app-text-3)" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* MISSION */}
      <section className="about-section" style={{ padding: "96px 48px", borderBottom: "1px solid var(--app-border)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "start" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 16 }}>
              Mission
            </div>
            <h2 style={{ fontSize: "clamp(24px,3.5vw,38px)", fontWeight: 700, lineHeight: 1.15, letterSpacing: "-0.025em", color: "var(--app-text)", marginTop: 0, marginBottom: 24 }}>
              Make shortage intelligence free for the people who need it most.
            </h2>
            <p style={{ fontSize: 15, color: "var(--app-text-3)", lineHeight: 1.75, marginBottom: 16 }}>
              A pharmacist in Adelaide shouldn&apos;t have to check four websites to know that
              their supplier&apos;s usual amoxicillin supplier is in shortage in three countries
              and a UK-registered alternative exists.
            </p>
            <p style={{ fontSize: 15, color: "var(--app-text-3)", lineHeight: 1.75, marginBottom: 0 }}>
              Mederti aggregates, normalises, and surfaces that data in one place — free
              for individual clinicians, with institutional tier for procurement teams who
              need real-time alerts and export.
            </p>
          </div>
          <div style={{ paddingTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 16 }}>
              What we are not
            </div>
            {[
              ["Not a wholesaler", "We don't sell drugs or facilitate procurement. We surface information."],
              ["Not a clinical advisor", "Data from Mederti requires verification before clinical use. Always confirm with your regulatory authority."],
              ["Not affiliated with regulators", "Mederti is not endorsed by or affiliated with the FDA, TGA, EMA, or any other regulatory body."],
            ].map(([title, body]) => (
              <div key={title as string} style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--app-text)", marginBottom: 6 }}>{title}</div>
                <div style={{ fontSize: 14, color: "var(--app-text-3)", lineHeight: 1.65 }}>{body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="about-section" style={{ padding: "96px 48px", background: "var(--app-bg)", borderBottom: "1px solid var(--app-border)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 16 }}>
            How it works
          </div>
          <h2 style={{ fontSize: "clamp(24px,3.5vw,38px)", fontWeight: 700, lineHeight: 1.15, letterSpacing: "-0.025em", color: "var(--app-text)", marginBottom: 56, marginTop: 0 }}>
            From regulatory notice to your screen in hours.
          </h2>
          <div className="about-how-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 32 }}>
            {HOW.map((h) => (
              <div key={h.step} style={{ background: "var(--panel)", border: "1px solid var(--app-border)", borderRadius: 12, padding: "32px 28px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "var(--teal)", marginBottom: 16 }}>
                  {h.step}
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--app-text)", marginBottom: 12, letterSpacing: "-0.02em" }}>
                  {h.title}
                </div>
                <div style={{ fontSize: 14, color: "var(--app-text-3)", lineHeight: 1.75 }}>
                  {h.body}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DATA SOURCES */}
      <section className="about-section" style={{ padding: "96px 48px", borderBottom: "1px solid var(--app-border)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 16 }}>
            Data sources
          </div>
          <h2 style={{ fontSize: "clamp(22px,3vw,34px)", fontWeight: 700, lineHeight: 1.15, letterSpacing: "-0.025em", color: "var(--app-text)", marginBottom: 12, marginTop: 0 }}>
            Official regulatory data only.
          </h2>
          <p style={{ fontSize: 15, color: "var(--app-text-3)", marginBottom: 48, lineHeight: 1.65 }}>
            Every shortage record traces back to a public government source. No scraped forum posts, no unverified reports.
          </p>
          <div className="about-sources-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
            {SOURCES.map((s) => (
              <div key={s.code} style={{
                background: "var(--app-bg)", border: "1px solid var(--app-border)",
                borderRadius: 8, padding: "16px 18px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--teal)", letterSpacing: "0.05em" }}>{s.code}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--app-text)" }}>{s.name}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--app-text-4)", lineHeight: 1.5 }}>{s.full}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, fontSize: 13, color: "var(--app-text-4)" }}>
            + 8 additional sources being integrated (NL, DK, IE, SE, CZ, HU, CH, NO)
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="about-section" style={{ padding: "96px 48px", background: "var(--app-bg)" }}>
        <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
          <h2 style={{ fontSize: "clamp(24px,3.5vw,40px)", fontWeight: 700, lineHeight: 1.15, letterSpacing: "-0.025em", color: "var(--app-text)", marginBottom: 16, marginTop: 0 }}>
            Built for pharmacists,<br />by people who've been there.
          </h2>
          <p style={{ fontSize: 15, color: "var(--app-text-3)", lineHeight: 1.7, marginBottom: 36 }}>
            Questions, partnership requests, or data corrections?<br />
            We read every email.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/contact" style={{
              fontSize: 14, fontWeight: 600, padding: "12px 28px",
              background: "var(--teal)", color: "#fff", borderRadius: 8, textDecoration: "none",
            }}>
              Get in touch
            </Link>
            <Link href="/dashboard" style={{
              fontSize: 14, fontWeight: 500, padding: "12px 28px",
              background: "var(--panel)", color: "var(--app-text-2)", border: "1px solid var(--app-border-2)", borderRadius: 8, textDecoration: "none",
            }}>
              View dashboard →
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="about-footer" style={{
      borderTop: "1px solid var(--app-border)",
      padding: "32px 48px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      background: "var(--app-bg)",
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--app-text)", letterSpacing: "-0.02em" }}>
        Mederti<span style={{ color: "var(--teal)" }}>.</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--app-text-4)" }}>
        © 2026 Mederti · Global pharmaceutical shortage intelligence
      </div>
      <div className="about-footer-links" style={{ display: "flex", gap: 20 }}>
        <Link href="/about" style={{ fontSize: 13, color: "var(--teal)", textDecoration: "none", fontWeight: 500 }}>About</Link>
        <Link href="/privacy" style={{ fontSize: 13, color: "var(--app-text-4)", textDecoration: "none" }}>Privacy</Link>
        <Link href="/terms" style={{ fontSize: 13, color: "var(--app-text-4)", textDecoration: "none" }}>Terms</Link>
        <a href="mailto:hello@mederti.com" style={{ fontSize: 13, color: "var(--app-text-4)", textDecoration: "none" }}>Contact</a>
      </div>
    </footer>
  );
}
