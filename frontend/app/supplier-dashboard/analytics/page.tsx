import type { Metadata } from "next";
import SiteNav from "@/app/components/landing-nav";
import SupplierAnalyticsClient from "./SupplierAnalyticsClient";

export const metadata: Metadata = {
  title: "Analytics — Mederti Supplier Dashboard",
  description: "Profile views, inventory views, enquiries received, and quote conversion rate.",
};

export default function SupplierAnalyticsPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--app-bg)" }}>
      <SiteNav />
      <SupplierAnalyticsClient />
    </div>
  );
}
