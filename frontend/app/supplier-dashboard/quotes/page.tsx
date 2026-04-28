import type { Metadata } from "next";
import SiteNav from "@/app/components/landing-nav";
import SupplierQuotesClient from "./SupplierQuotesClient";

export const metadata: Metadata = {
  title: "Quotes Pipeline — Mederti",
  description: "Track buyer quotes from submitted to won.",
};

export default function SupplierQuotesPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--app-text)" }}>
      <SiteNav />
      <SupplierQuotesClient />
    </div>
  );
}
