import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { PostHogProvider } from "@/lib/analytics/posthog-provider";
import { GoogleTag } from "@/lib/analytics/google-tag";
import CookieConsent from "@/app/components/CookieConsent";
import { siteUrl, jsonLdSafe, organizationJsonLd, webSiteJsonLd } from "@/lib/seo";
import "./globals.css";
import { COVERAGE_COPY } from "@/lib/coverage-copy";

// Canonical origin, env-driven. Set NEXT_PUBLIC_SITE_URL in prod to the final
// domain (e.g. https://mederti.com); falls back to the Vercel URL then the
// production default. Never hardcode the preview host here — it leaks into
// metadataBase, OG and Twitter card URLs site-wide.
const SITE_URL = siteUrl();

export const metadata: Metadata = {
  title: {
    default: "Mederti — Global Drug Shortage Intelligence Platform",
    template: "%s",
  },
  description:
    `Real-time pharmaceutical shortage tracking across ${COVERAGE_COPY.countries}. ${COVERAGE_COPY.products} monitored. TGA, FDA, MHRA, EMA and more regulatory sources. Used by pharmacists, hospitals, and health systems.`,
  keywords: ["drug shortage", "medicine shortage", "pharmaceutical shortage", "TGA shortage", "FDA drug shortage", "MHRA shortage", "medicine availability", "drug recall"],
  metadataBase: new URL(SITE_URL),
  openGraph: {
    title: "Mederti — Global Drug Shortage Intelligence",
    description:
      `Track drug shortages across ${COVERAGE_COPY.countries} in real time. ${COVERAGE_COPY.products} monitored from official regulatory sources.`,
    url: SITE_URL,
    siteName: "Mederti",
    type: "website",
    images: [
      {
        url: `${SITE_URL}/api/og`,
        width: 1200,
        height: 630,
        alt: "Mederti — Every drug shortage. Every regulator. One verified view.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mederti — Global Drug Shortage Intelligence",
    description:
      `Track drug shortages across ${COVERAGE_COPY.countries} in real time. ${COVERAGE_COPY.products} monitored from official regulatory sources.`,
    images: [`${SITE_URL}/api/og`],
  },
  // Search-console ownership tags, env-driven so no DNS record is needed:
  //   NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION → Google Search Console
  //   NEXT_PUBLIC_BING_SITE_VERIFICATION   → Bing Webmaster Tools (msvalidate.01)
  // Bing matters disproportionately for us: Edge + Bing are the default
  // browser/search on managed NHS / hospital Windows fleets, and the Bing
  // index also feeds Copilot answers.
  verification: {
    ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
      ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION.trim() }
      : {}),
    ...(process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION
      ? { other: { "msvalidate.01": process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION.trim() } }
      : {}),
  },
  applicationName: "Mederti",
  // Windows/Edge pinned-site + taskbar tile colour (Edge still reads these).
  other: {
    "msapplication-TileColor": "#0fa676",
    "msapplication-config": "none",
  },
};

export const viewport: Viewport = {
  themeColor: "#0fa676",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head />
      <body className="antialiased">
        {/* Site-wide entity graph: lets Google + AI crawlers resolve Mederti
            as a stable Organization entity from any landing URL. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdSafe(organizationJsonLd()) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdSafe(webSiteJsonLd()) }}
        />
        <PostHogProvider>{children}</PostHogProvider>
        {/* Google Ads tag (gtag.js) — loads only after cookie consent. */}
        <GoogleTag />
        <CookieConsent />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
