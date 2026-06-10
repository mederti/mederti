import type { Metadata } from "next";
import AppShell from "@/app/components/v1/AppShell";
import RegulatoryCalendarClient from "./RegulatoryCalendarClient";

export const metadata: Metadata = {
  title: "Regulatory Calendar — Mederti Intelligence",
  description: "Upcoming FDA Advisory Committee meetings, EMA CHMP opinions, and regulatory decisions across major markets worldwide.",
};

export default function CalendarPage() {
  return (
    <AppShell contentClassName="flush">
      <RegulatoryCalendarClient />
    </AppShell>
  );
}
