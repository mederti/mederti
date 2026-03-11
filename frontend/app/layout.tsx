import type { Metadata } from "next";
import { Inter, DM_Mono } from "next/font/google";
import ThemeProvider from "./components/theme-provider";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mederti — Global Pharmaceutical Shortage Intelligence",
  description:
    "Real-time pharmaceutical shortage intelligence from regulatory bodies across 9 countries.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head />
      <body className={`${inter.variable} ${dmMono.variable} antialiased`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
