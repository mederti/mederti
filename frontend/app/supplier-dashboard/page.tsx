import type { Metadata } from "next";
import SupplierDashboardClient from "./SupplierDashboardClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mederti Supplier Dashboard — Supply opportunity intelligence",
  description:
    "Identify shortage opportunities, monitor portfolio risk, and find market gaps with real-time pharmaceutical supply intelligence.",
  openGraph: {
    title: "Mederti Supplier Dashboard — Supply opportunity intelligence",
    description:
      "Identify shortage opportunities, monitor portfolio risk, and find market gaps with real-time pharmaceutical supply intelligence.",
  },
};

export default function SupplierDashboardPage() {
  return <SupplierDashboardClient />;
}
