import type { Metadata } from "next";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";
import RegulatoryCalendarClient from "./RegulatoryCalendarClient";

export const metadata: Metadata = {
  title: "Regulatory Calendar — Mederti Intelligence",
  description: "Upcoming FDA Advisory Committee meetings, EMA CHMP opinions, and regulatory decisions across 22 countries.",
};

export default function CalendarPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--app-bg)", display: "flex", flexDirection: "column" }}>
      <SiteNav />
      <RegulatoryCalendarClient />
      <SiteFooter />
    </div>
  );
}
