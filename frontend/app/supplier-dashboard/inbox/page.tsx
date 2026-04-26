import type { Metadata } from "next";
import SiteNav from "@/app/components/landing-nav";
import SupplierInboxClient from "./SupplierInboxClient";

export const metadata: Metadata = {
  title: "Supplier Inbox — Mederti",
  description: "Real-time buyer enquiries from hospitals and pharmacies in your territory.",
};

export default function SupplierInboxPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--app-text)" }}>
      <SiteNav />
      <SupplierInboxClient />
    </div>
  );
}
