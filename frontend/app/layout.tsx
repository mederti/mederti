import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { PostHogProvider } from "@/lib/analytics/posthog-provider";
import "./globals.css";

const SITE_URL = "https://mederti.vercel.app";

export const metadata: Metadata = {
  title: {
    default: "Mederti — Global Drug Shortage Intelligence Platform",
    template: "%s",
  },
  description:
    "Real-time pharmaceutical shortage tracking across major markets. 216,000+ drugs monitored. TGA, FDA, MHRA, EMA and more regulatory sources. Used by pharmacists, hospitals, and health systems.",
  keywords: ["drug shortage", "medicine shortage", "pharmaceutical shortage", "TGA shortage", "FDA drug shortage", "MHRA shortage", "medicine availability", "drug recall"],
  metadataBase: new URL(SITE_URL),
  openGraph: {
    title: "Mederti — Global Drug Shortage Intelligence",
    description:
      "Track drug shortages across major markets in real time. 216,000+ drugs monitored from regulatory sources worldwide.",
    url: SITE_URL,
    siteName: "Mederti",
    type: "website",
    images: [
      {
        url: `${SITE_URL}/api/og`,
        width: 1200,
        height: 630,
        alt: "Mederti — The world's pharma intelligence platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mederti — Global Drug Shortage Intelligence",
    description:
      "Track drug shortages across major markets in real time. 216,000+ drugs monitored from regulatory sources worldwide.",
    images: [`${SITE_URL}/api/og`],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head />
      <body className="antialiased">
        <PostHogProvider>{children}</PostHogProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
