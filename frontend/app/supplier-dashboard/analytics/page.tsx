import type { Metadata } from "next";
import AppShell from "@/app/components/v1/AppShell";
import SupplierAnalyticsClient from "./SupplierAnalyticsClient";

export const metadata: Metadata = {
  title: "Analytics — Mederti Supplier Dashboard",
  description: "Profile views, inventory views, enquiries received, and quote conversion rate.",
};

export default function SupplierAnalyticsPage() {
  return (
    <AppShell contentClassName="flush base-type">
      <div style={{ minHeight: "100vh", background: "var(--app-bg)" }}>
        <SupplierAnalyticsClient />
      </div>
    </AppShell>
  );
}
