import Link from "next/link";
import type { Metadata } from "next";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";

export const metadata: Metadata = {
  title: "Terms of Service — Mederti",
  description: "Terms and conditions for using the Mederti pharmaceutical shortage intelligence platform.",
};

export default function TermsPage() {
  return (
    <div style={{ background: "#fff", minHeight: "100vh", color: "var(--app-text)", fontFamily: "var(--font-inter), sans-serif" }}>

      <SiteNav />

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px 80px" }}>

        <p style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--app-text-4)", marginBottom: 12 }}>
          Last updated: 23 February 2026
        </p>
        <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em", color: "var(--app-text)", marginBottom: 8, marginTop: 0 }}>
          Terms of Service
        </h1>
        <p style={{ fontSize: 15, color: "var(--app-text-3)", lineHeight: 1.7, marginBottom: 40 }}>
          These terms govern your use of Mederti. By accessing or using this service, you agree to be
          bound by them. If you do not agree, do not use Mederti.
        </p>

        <Section title="1. The service">
          Mederti aggregates publicly available pharmaceutical shortage data from regulatory bodies
          including the FDA, TGA, EMA, and others. The platform is provided as an intelligence and
          monitoring tool for healthcare professionals, researchers, and interested parties.
        </Section>

        <Section title="2. Data accuracy disclaimer">
          <strong style={{ color: "var(--crit)" }}>Important:</strong> Shortage data on Mederti is
          sourced from third-party regulatory databases and may not be complete, current, or accurate
          at all times. Scraping and normalisation processes introduce potential for errors or
          omissions.<br /><br />
          <strong>Mederti data must not be used as the sole basis for clinical, dispensing, or
          prescribing decisions.</strong> Always verify shortage information directly with the
          relevant regulatory authority, your pharmaceutical wholesaler, or your hospital pharmacy
          team before making clinical or procurement decisions.<br /><br />
          Mederti expressly disclaims any liability for decisions made based on information displayed
          on this platform.
        </Section>

        <Section title="3. Acceptable use">
          You agree not to:<br /><br />
          <ul style={{ paddingLeft: 20, lineHeight: 2, margin: 0 }}>
            <li>Use Mederti for any unlawful purpose</li>
            <li>Attempt to scrape, reverse-engineer, or bulk-export data in a way that disrupts the service</li>
            <li>Submit false information or create accounts for others without authorisation</li>
            <li>Resell or sublicense access to Mederti data without written permission</li>
            <li>Attempt to access any data you are not authorised to access</li>
          </ul>
        </Section>

        <Section title="4. Accounts">
          You are responsible for maintaining the security of your account credentials.
          Notify us immediately at{" "}
          <a href="mailto:hello@mederti.com" style={{ color: "var(--teal)" }}>hello@mederti.com</a>{" "}
          if you suspect unauthorised access. We reserve the right to suspend or terminate accounts
          that violate these terms.
        </Section>

        <Section title="5. Intellectual property">
          The Mederti platform, including its design, code, and presentation of data, is owned by
          Mederti and protected by applicable intellectual property laws. Underlying shortage data
          sourced from regulatory bodies is in the public domain in its raw form; Mederti's
          normalisation, enrichment, and presentation of that data is proprietary.
        </Section>

        <Section title="6. Limitation of liability">
          To the maximum extent permitted by applicable law, Mederti shall not be liable for any
          indirect, incidental, special, consequential, or punitive damages arising from your use of,
          or inability to use, the service — including but not limited to damages for loss of profits,
          data, goodwill, or other intangible losses.<br /><br />
          Our total liability to you for any direct damages shall not exceed AUD $100 or the amount
          you paid us in the prior 12 months, whichever is greater.
        </Section>

        <Section title="7. Indemnification">
          You agree to indemnify and hold harmless Mederti and its officers, directors, and employees
          from any claims, damages, or expenses arising from your use of the service in violation of
          these terms.
        </Section>

        <Section title="8. Third-party sources">
          Shortage data is sourced from public regulatory databases. Mederti is not affiliated with
          or endorsed by the FDA, TGA, EMA, or any other regulatory body listed on the platform.
        </Section>

        <Section title="9. Service availability">
          Mederti is provided "as is" without warranty of any kind. We do not guarantee uninterrupted
          availability. We may modify or discontinue features at any time with reasonable notice.
        </Section>

        <Section title="10. Governing law">
          These terms are governed by the laws of New South Wales, Australia. Any disputes will be
          resolved in the courts of New South Wales.
        </Section>

        <Section title="11. Changes to these terms">
          We may revise these terms at any time. Material changes will be communicated to registered
          users via email at least 14 days before taking effect. Continued use after that date
          constitutes acceptance.
        </Section>

        <Section title="12. Contact">
          Questions about these terms:{" "}
          <a href="mailto:hello@mederti.com" style={{ color: "var(--teal)" }}>hello@mederti.com</a>
        </Section>

      </div>

      <SiteFooter />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--app-text)", marginBottom: 10, marginTop: 0 }}>
        {title}
      </h2>
      <p style={{ fontSize: 14, color: "var(--app-text-2)", lineHeight: 1.75, margin: 0 }}>
        {children}
      </p>
    </div>
  );
}
