export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import DashboardClient from "./DashboardClient";

export const metadata: Metadata = {
  title: "Mederti Dashboard — Real-time pharmaceutical shortage command centre",
  description:
    "Live operational dashboard for drug shortage monitoring. Active shortages, severity alerts, regional supply maps, and predictive intelligence.",
  openGraph: {
    title: "Mederti Dashboard — Real-time pharmaceutical shortage command centre",
    description:
      "Live operational dashboard for drug shortage monitoring. Active shortages, severity alerts, regional supply maps, and predictive intelligence.",
  },
};

export default function DashboardPage() {
  return <DashboardClient />;
}
