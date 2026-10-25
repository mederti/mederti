import type { Metadata } from "next";
import AppShell from "@/app/components/v1/AppShell";
import SupplierInboxClient from "./SupplierInboxClient";

export const metadata: Metadata = {
  title: "Supplier Inbox — Mederti",
  description: "Real-time buyer enquiries from hospitals and pharmacies in your territory.",
};

export default function SupplierInboxPage() {
  return (
    <AppShell contentClassName="flush">
      <div style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--app-text)" }}>
        <SupplierInboxClient />
      </div>
    </AppShell>
  );
}
