import Link from "next/link";
import type { Metadata } from "next";
import SiteNav from "@/app/components/landing-nav";
import MinimalFooter from "@/app/components/minimal-footer";
import CookiePreferencesLink from "@/app/components/CookiePreferencesLink";

export const metadata: Metadata = {
  title: "Privacy Policy — Mederti",
  description: "How Mederti collects, uses, and protects your personal data.",
};

export default function PrivacyPage() {
  return (
    <div style={{ background: "#fff", minHeight: "100vh", color: "var(--app-text)", fontFamily: "var(--font-inter), sans-serif" }}>

      <SiteNav />

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px 80px" }}>

        <p style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--app-text-4)", marginBottom: 12 }}>
          Last updated: 16 July 2026
        </p>
        <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em", color: "var(--app-text)", marginBottom: 8, marginTop: 0 }}>
          Privacy Policy
        </h1>
        <p style={{ fontSize: 15, color: "var(--app-text-3)", lineHeight: 1.7, marginBottom: 40 }}>
          This policy explains what data Mederti collects, why, and how you can control it.
          Mederti is operated as a global pharmaceutical shortage intelligence platform.
        </p>

        <Section title="1. Who we are">
          Mederti provides real-time pharmaceutical shortage intelligence aggregated from regulatory
          bodies worldwide. For GDPR purposes, Mederti acts as the data controller for personal data
          collected through this website. Contact:{" "}
          <a href="mailto:privacy@mederti.com" style={{ color: "var(--teal)" }}>privacy@mederti.com</a>.
        </Section>

        <Section title="2. Data we collect">
          <b>Email address</b> — if you subscribe to shortage alerts or create an account, we store
          your email address to send you relevant notifications.<br /><br />
          <b>Authentication data</b> — if you create an account, Supabase stores a hashed password
          and session tokens. We never see your plaintext password.<br /><br />
          <b>Watchlist preferences</b> — drugs you add to your watchlist are stored against your
          user account to trigger shortage alerts.<br /><br />
          <b>Usage data</b> — standard server logs (IP address, browser type, pages visited) may
          be retained for up to 90 days for security and performance purposes.<br /><br />
          <b>Product analytics (with your consent)</b> — if you accept analytics cookies, we use
          PostHog (hosted in the EU) to understand how the product is used: pages visited, features
          clicked, and — for signed-in users — your account ID and role. We do not record your
          screen, the text you type, or your search terms. If you decline, PostHog never loads.<br /><br />
          <b>Anonymous traffic measurement</b> — Vercel Analytics counts page visits without
          cookies or persistent identifiers, so it cannot follow you across visits or sites.<br /><br />
          <b>Error reports</b> — if a page crashes, technical details of the error may be sent to
          Sentry so we can fix it. No tracking cookies are involved.
        </Section>

        <Section title="2a. Cookies and local storage">
          <b>Essential (always on):</b>
          <ul style={{ paddingLeft: 20, lineHeight: 2, margin: 0 }}>
            <li><b>Supabase auth cookies</b> — keep you logged in.</li>
            <li><b>mederti-country</b> — remembers the country you selected (12 months).</li>
            <li><b>mederti-device</b> — remembers whether you&apos;re on desktop or mobile so we
              can serve the right layout.</li>
            <li><b>mederti-consent</b> — remembers your cookie choice (12 months).</li>
            <li><b>Browser local storage</b> — holds your chat history, watchlist, and dismissed
              notices on your own device; none of it is transmitted for tracking.</li>
          </ul>
          <br />
          <b>Optional (only with your consent):</b>
          <ul style={{ paddingLeft: 20, lineHeight: 2, margin: 0 }}>
            <li><b>PostHog analytics cookies</b> (names beginning <code>ph_</code>) — distinguish
              your browser between visits so we can measure product usage.</li>
          </ul>
          <br />
          We do not use advertising cookies. You can change or withdraw your choice at any time
          via <CookiePreferencesLink style={{ color: "var(--teal)", fontSize: 14 }} /> (also linked
          in the footer of every page). Withdrawing consent stops analytics immediately and deletes
          the PostHog cookies from your browser.
        </Section>

        <Section title="3. How we use your data">
          <ul style={{ paddingLeft: 20, lineHeight: 2, margin: 0 }}>
            <li>Send shortage alert emails for drugs on your watchlist</li>
            <li>Send a welcome email when you subscribe (you can unsubscribe at any time)</li>
            <li>Maintain your login session</li>
            <li>Detect and prevent abuse or security incidents</li>
          </ul>
          We do not sell, rent, or share your personal data with third parties for marketing purposes.
        </Section>

        <Section title="4. Legal basis (GDPR)">
          For users in the European Economic Area, we process personal data under the following
          legal bases:<br /><br />
          <b>Consent</b> — email subscriptions and analytics cookies (you can withdraw either at
          any time).<br />
          <b>Contract</b> — account creation and watchlist features (needed to provide the service).<br />
          <b>Legitimate interests</b> — security logging and abuse prevention.
        </Section>

        <Section title="5. Data retention">
          <b>Email subscribers:</b> retained until you unsubscribe or request deletion.<br />
          <b>Account data:</b> retained while your account is active and for 30 days after deletion.<br />
          <b>Server logs:</b> retained for up to 90 days.
        </Section>

        <Section title="6. Third-party services">
          <b>Supabase</b> — database and authentication (EU data hosting available). Privacy policy:
          supabase.com/privacy<br /><br />
          <b>Resend</b> — transactional email delivery. Privacy policy: resend.com/privacy<br /><br />
          <b>Vercel</b> — website hosting and cookieless traffic measurement. Privacy policy:
          vercel.com/legal/privacy-policy<br /><br />
          <b>PostHog</b> — product analytics, EU-hosted, loaded only with your consent. Privacy
          policy: posthog.com/privacy<br /><br />
          <b>Sentry</b> — error monitoring. Privacy policy: sentry.io/privacy<br /><br />
          Shortage data is sourced from public regulatory databases (FDA, TGA, EMA, etc.) and
          contains no personal data.
        </Section>

        <Section title="7. Your rights">
          If you are in the EEA or UK, you have the right to:<br /><br />
          <ul style={{ paddingLeft: 20, lineHeight: 2, margin: 0 }}>
            <li><b>Access</b> the personal data we hold about you</li>
            <li><b>Correct</b> inaccurate data</li>
            <li><b>Delete</b> your data ("right to be forgotten")</li>
            <li><b>Object</b> to processing based on legitimate interests</li>
            <li><b>Portability</b> — receive your data in a machine-readable format</li>
          </ul>
          <br />
          To exercise any of these rights, email{" "}
          <a href="mailto:privacy@mederti.com" style={{ color: "var(--teal)" }}>privacy@mederti.com</a>.
          We will respond within 30 days.
        </Section>

        <Section title="8. Security">
          All data is encrypted in transit (TLS) and at rest. Database access is controlled via
          row-level security policies. We do not store payment information.
        </Section>

        <Section title="9. Changes to this policy">
          We may update this policy. Material changes will be notified via email to registered users.
          The "Last updated" date at the top of this page reflects the most recent revision.
        </Section>

        <Section title="10. Contact">
          Questions about this policy:{" "}
          <a href="mailto:privacy@mederti.com" style={{ color: "var(--teal)" }}>privacy@mederti.com</a>
        </Section>

      </div>

      <MinimalFooter />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--app-text)", marginBottom: 10, marginTop: 0 }}>
        {title}
      </h2>
      <div style={{ fontSize: 14, color: "var(--app-text-2)", lineHeight: 1.75, margin: 0 }}>
        {children}
      </div>
    </div>
  );
}
