import type { Metadata } from "next";
import AppShell from "@/app/components/v1/AppShell";
import SupplierQuotesClient from "./SupplierQuotesClient";

export const metadata: Metadata = {
  title: "Quotes Pipeline — Mederti",
  description: "Track buyer quotes from submitted to won.",
};

export default function SupplierQuotesPage() {
  return (
    <AppShell contentClassName="flush">
      <div style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--app-text)" }}>
        <SupplierQuotesClient />
      </div>
    </AppShell>
  );
}
