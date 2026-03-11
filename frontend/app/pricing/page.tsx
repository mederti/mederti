import Link from "next/link";
import type { Metadata } from "next";
import SiteNav from "@/app/components/landing-nav";

export const metadata: Metadata = {
  title: "Pricing — Mederti",
  description: "Free for individual pharmacists. Institutional pricing for procurement teams and health ministries.",
};

const FREE_FEATURES = [
  "Drug shortage search",
  "5 country availability view",
  "Basic alternative suggestions",
  "3 drug watchlist alerts",
  "Weekly shortage brief",
];

const PRO_FEATURES = [
  "Everything in Free",
  "Full analyst view with source data",
  "Unlimited watchlist alerts",
  "6-hourly data refresh",
  "AI shortage assistant",
  "Exportable PDF reports",
  "Expert curator commentary",
  "Up to 20 team seats",
];

const ENT_FEATURES = [
  "Everything in Pro",
  "National supply dashboard",
  "AI early warning system",
  "Ministerial briefing generator",
  "Hourly refresh",
  "Dedicated data analyst",
  "API access",
  "SLA + compliance docs",
];

const FAQS = [
  {
    q: "Is the Free tier really free?",
    a: "Yes — always. Individual pharmacists, clinicians, and researchers get full search and shortage visibility at no cost. We're committed to keeping basic shortage intelligence accessible.",
  },
  {
    q: "What counts as an institution for Pro?",
    a: "A hospital, pharmacy group, wholesaler, distributor, or any organisation with multiple users needing shortage intelligence. The $800/mo seat covers up to 20 users across your organisation.",
  },
  {
    q: "Can I trial Pro before committing?",
    a: "Yes. Pro comes with a 14-day free trial, no credit card required. You'll get full access to all Pro features during the trial period.",
  },
  {
    q: "How often is the data refreshed?",
    a: "Free users get data updated every 12 hours. Pro users get 6-hourly refreshes. Enterprise customers with critical supply requirements can request hourly updates.",
  },
  {
    q: "Is there an API for integrating shortage data into our systems?",
    a: "API access is available on the Enterprise tier. It includes RESTful endpoints for shortage queries, watchlist webhooks, and bulk export for your existing procurement or clinical systems.",
  },
  {
    q: "What's the refund policy?",
    a: "If you're not satisfied within the first 30 days of a paid subscription, we'll refund you in full, no questions asked.",
  },
];

export default function PricingPage() {
  return (
    <div style={{ background: "var(--panel)", minHeight: "100vh", color: "var(--app-text)", fontFamily: "var(--font-inter), sans-serif" }}>
      <style>{`
        @media (max-width: 768px) {
          .pricing-hero { padding: 80px 20px 60px !important; }
          .pricing-section { padding: 60px 20px !important; }
          .pricing-cards { grid-template-columns: 1fr !important; max-width: 420px !important; }
          .pricing-faq { grid-template-columns: 1fr !important; }
          .pricing-footer { padding: 24px 20px !important; flex-direction: column !important; gap: 12px !important; text-align: center !important; }
          .pricing-footer-links { justify-content: center !important; }
        }
      `}</style>

      <SiteNav />

      {/* HERO */}
      <section className="pricing-hero" style={{ padding: "96px 48px 80px", background: "var(--app-bg)", borderBottom: "1px solid var(--app-border)" }}>
        <div style={{ maxWidth: 600 }}>
          <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 16 }}>
            Pricing
          </div>
          <h1 style={{ fontSize: "clamp(32px,5vw,56px)", fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.03em", color: "var(--app-text)", marginBottom: 20, marginTop: 0 }}>
            Start free.<br />Scale when it matters.
          </h1>
          <p style={{ fontSize: 17, color: "var(--app-text-3)", lineHeight: 1.65, margin: 0 }}>
            Free for individual pharmacists and clinicians. Institutional pricing for procurement teams, hospitals, and health ministries.
          </p>
        </div>
      </section>

      {/* CARDS */}
      <section className="pricing-section" style={{ padding: "80px 48px", borderBottom: "1px solid var(--app-border)" }}>
        <div className="pricing-cards" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20, maxWidth: 1000, margin: "0 auto" }}>

          {/* Free */}
          <div style={{ background: "var(--panel)", border: "1px solid var(--app-border)", borderRadius: 14, padding: "36px 32px" }}>
            <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--app-text-4)", marginBottom: 20 }}>Free</div>
            <div style={{ fontSize: 48, fontWeight: 700, color: "var(--app-text)", lineHeight: 1, marginBottom: 4, letterSpacing: "-0.03em" }}>
              $0<span style={{ fontSize: 16, color: "var(--app-text-4)", fontWeight: 400, letterSpacing: 0 }}>/mo</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--app-text-4)", marginBottom: 32, paddingBottom: 32, borderBottom: "1px solid var(--app-border)" }}>
              For individual pharmacists and clinicians
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 36, flexGrow: 1 }}>
              {FREE_FEATURES.map((f) => (
                <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, color: "var(--app-text-2)" }}>
                  <span style={{ color: "var(--teal)", flexShrink: 0, marginTop: 1 }}>✓</span>{f}
                </div>
              ))}
            </div>
            <Link href="/signup" style={{
              display: "block", width: "100%", padding: "12px",
              borderRadius: 8, fontSize: 14, fontWeight: 500, textAlign: "center",
              background: "var(--panel)", border: "1px solid var(--app-border-2)", color: "var(--app-text-2)",
              textDecoration: "none", boxSizing: "border-box",
            }}>
              Get started free
            </Link>
          </div>

          {/* Pro */}
          <div style={{
            background: "var(--app-text)", border: "1px solid var(--app-text)",
            borderRadius: 14, padding: "36px 32px", position: "relative",
          }}>
            <div style={{
              position: "absolute", top: -1, left: "50%", transform: "translateX(-50%)",
              fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
              background: "var(--teal)", color: "#fff", padding: "4px 14px", borderRadius: "0 0 8px 8px",
              whiteSpace: "nowrap",
            }}>
              Most popular
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: 20 }}>Pro</div>
            <div style={{ fontSize: 48, fontWeight: 700, color: "#fff", lineHeight: 1, marginBottom: 4, letterSpacing: "-0.03em" }}>
              $800<span style={{ fontSize: 16, color: "rgba(255,255,255,0.4)", fontWeight: 400, letterSpacing: 0 }}>/mo</span>
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 32, paddingBottom: 32, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
              Per institution · hospital, pharmacy group or distributor
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 36 }}>
              {PRO_FEATURES.map((f) => (
                <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, color: "rgba(255,255,255,0.75)" }}>
                  <span style={{ color: "var(--teal)", flexShrink: 0, marginTop: 1 }}>✓</span>{f}
                </div>
              ))}
            </div>
            <Link href="/contact?subject=Pro+trial" style={{
              display: "block", width: "100%", padding: "12px",
              borderRadius: 8, fontSize: 14, fontWeight: 600, textAlign: "center",
              background: "var(--teal)", border: "none", color: "#fff",
              textDecoration: "none", boxSizing: "border-box",
            }}>
              Start 14-day free trial
            </Link>
          </div>

          {/* Enterprise */}
          <div style={{ background: "var(--panel)", border: "1px solid var(--app-border)", borderRadius: 14, padding: "36px 32px" }}>
            <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--app-text-4)", marginBottom: 20 }}>Enterprise</div>
            <div style={{ fontSize: 36, fontWeight: 700, color: "var(--app-text)", lineHeight: 1, marginBottom: 4, letterSpacing: "-0.02em" }}>Custom</div>
            <div style={{ fontSize: 13, color: "var(--app-text-4)", marginBottom: 32, paddingBottom: 32, borderBottom: "1px solid var(--app-border)" }}>
              For regulators, health ministries and large distributors
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 36 }}>
              {ENT_FEATURES.map((f) => (
                <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, color: "var(--app-text-2)" }}>
                  <span style={{ color: "var(--teal)", flexShrink: 0, marginTop: 1 }}>✓</span>{f}
                </div>
              ))}
            </div>
            <Link href="/contact?subject=Enterprise+enquiry" style={{
              display: "block", width: "100%", padding: "12px",
              borderRadius: 8, fontSize: 14, fontWeight: 500, textAlign: "center",
              background: "var(--panel)", border: "1px solid var(--app-border-2)", color: "var(--app-text-2)",
              textDecoration: "none", boxSizing: "border-box",
            }}>
              Talk to us →
            </Link>
          </div>
        </div>

        <p style={{ textAlign: "center", marginTop: 28, fontSize: 13, color: "var(--app-text-4)" }}>
          All prices in AUD. Institutional pricing is per-organisation, not per-seat for Pro.
          30-day money-back guarantee on all paid plans.
        </p>
      </section>

      {/* FAQ */}
      <section className="pricing-section" style={{ padding: "96px 48px", background: "var(--app-bg)", borderBottom: "1px solid var(--app-border)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 16 }}>
            FAQ
          </div>
          <h2 style={{ fontSize: "clamp(22px,3vw,36px)", fontWeight: 700, lineHeight: 1.15, letterSpacing: "-0.025em", color: "var(--app-text)", marginBottom: 56, marginTop: 0 }}>
            Common questions
          </h2>
          <div className="pricing-faq" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 64px" }}>
            {FAQS.map((faq) => (
              <div key={faq.q} style={{ borderTop: "1px solid var(--app-border)", paddingTop: 28, paddingBottom: 28 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--app-text)", marginBottom: 10 }}>{faq.q}</div>
                <div style={{ fontSize: 14, color: "var(--app-text-3)", lineHeight: 1.75 }}>{faq.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="pricing-section" style={{ padding: "80px 48px", textAlign: "center" }}>
        <p style={{ fontSize: 13, color: "var(--app-text-4)", marginBottom: 8, marginTop: 0 }}>Still have questions?</p>
        <h2 style={{ fontSize: "clamp(22px,3vw,36px)", fontWeight: 700, letterSpacing: "-0.025em", color: "var(--app-text)", marginBottom: 28, marginTop: 0 }}>
          We&apos;re happy to talk through your use case.
        </h2>
        <Link href="/contact" style={{
          display: "inline-block", fontSize: 14, fontWeight: 600, padding: "13px 32px",
          background: "var(--teal)", color: "#fff", borderRadius: 8, textDecoration: "none",
        }}>
          Contact us →
        </Link>
      </section>

      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="pricing-footer" style={{
      borderTop: "1px solid var(--app-border)",
      padding: "32px 48px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      background: "var(--app-bg)",
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--app-text)", letterSpacing: "-0.02em" }}>
        Mederti<span style={{ color: "var(--teal)" }}>.</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--app-text-4)" }}>© 2026 Mederti · Global pharmaceutical shortage intelligence</div>
      <div className="pricing-footer-links" style={{ display: "flex", gap: 20 }}>
        <Link href="/about" style={{ fontSize: 13, color: "var(--app-text-4)", textDecoration: "none" }}>About</Link>
        <Link href="/privacy" style={{ fontSize: 13, color: "var(--app-text-4)", textDecoration: "none" }}>Privacy</Link>
        <Link href="/terms" style={{ fontSize: 13, color: "var(--app-text-4)", textDecoration: "none" }}>Terms</Link>
        <Link href="/pricing" style={{ fontSize: 13, color: "var(--teal)", textDecoration: "none", fontWeight: 500 }}>Pricing</Link>
      </div>
    </footer>
  );
}
