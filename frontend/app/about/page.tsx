import type { Metadata } from "next";
import SiteNav from "@/app/components/landing-nav";
import MinimalFooter from "@/app/components/minimal-footer";

export const metadata: Metadata = {
  title: "About — Mederti",
  description: "Mederti aggregates pharmaceutical shortage data from regulatory bodies worldwide to help clinicians and procurement teams act before supply chains fail.",
};

export default function AboutPage() {
  return (
    <div style={{ background: "#fff", minHeight: "100vh", color: "var(--app-text)", fontFamily: "var(--font-inter), sans-serif" }}>
      <SiteNav />

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "80px 24px 0" }}>
        <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.1, color: "var(--app-text)", margin: "0 0 24px" }}>
          About Mederti
        </h1>

        <p style={{ fontSize: 16, color: "var(--app-text-2)", lineHeight: 1.75, margin: "0 0 20px" }}>
          Mederti is global pharmaceutical shortage intelligence. We aggregate, normalise,
          and surface shortage and recall data from regulatory bodies worldwide — so a
          pharmacist, procurement team, or clinician can see in one place what would
          otherwise be scattered across dozens of regulatory websites in multiple languages.
        </p>

        <p style={{ fontSize: 16, color: "var(--app-text-2)", lineHeight: 1.75, margin: "0 0 20px" }}>
          The data is free for individual clinicians. Automated scrapers pull shortage
          notices directly from official sources, deduplicate them, resolve drug names
          against an international registry, and standardise severity and reason codes —
          then make it searchable by drug, country, and status, with therapeutic
          alternatives and watchlist alerts built in.
        </p>

        <div style={{ borderTop: "1px solid var(--app-border)", margin: "40px 0 0", paddingTop: 32 }}>
          {[
            ["Not a wholesaler", "We don't sell drugs or facilitate procurement. We surface information."],
            ["Not a clinical advisor", "Data from Mederti requires verification before clinical use. Always confirm with your regulatory authority."],
            ["Not affiliated with regulators", "Mederti is not endorsed by or affiliated with the FDA, TGA, EMA, or any other regulatory body."],
          ].map(([title, body]) => (
            <div key={title} style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--app-text)", marginBottom: 4 }}>{title}</div>
              <div style={{ fontSize: 14, color: "var(--app-text-3)", lineHeight: 1.65 }}>{body}</div>
            </div>
          ))}
        </div>

        <p style={{ fontSize: 15, color: "var(--app-text-3)", lineHeight: 1.7, margin: "20px 0 0" }}>
          Questions, partnership requests, or data corrections?{" "}
          <a href="mailto:hello@mederti.com" style={{ color: "var(--teal)", textDecoration: "none" }}>hello@mederti.com</a>
        </p>
      </div>

      <MinimalFooter />
    </div>
  );
}
