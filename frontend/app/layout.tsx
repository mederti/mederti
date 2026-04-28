import type { Metadata } from "next";
import { Inter, DM_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "optional",
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "optional",
});

const SITE_URL = "https://mederti.vercel.app";

export const metadata: Metadata = {
  title: {
    default: "Mederti — Global Drug Shortage Intelligence Platform",
    template: "%s",
  },
  description:
    "Real-time pharmaceutical shortage tracking across 20+ countries. 216,000+ drugs monitored. TGA, FDA, MHRA, EMA and 43 more regulatory sources. Used by pharmacists, hospitals, and health systems.",
  keywords: ["drug shortage", "medicine shortage", "pharmaceutical shortage", "TGA shortage", "FDA drug shortage", "MHRA shortage", "medicine availability", "drug recall"],
  metadataBase: new URL(SITE_URL),
  openGraph: {
    title: "Mederti — Global Drug Shortage Intelligence",
    description:
      "Track drug shortages across 20+ countries in real time. 216,000+ drugs monitored from 47 regulatory sources.",
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
      "Track drug shortages across 20+ countries in real time. 216,000+ drugs monitored from 47 regulatory sources.",
    images: [`${SITE_URL}/api/og`],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head />
      <body className={`${inter.variable} ${dmMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
