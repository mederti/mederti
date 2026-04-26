import type { Metadata } from "next";
import SiteNav from "@/app/components/landing-nav";
import SupplierProfileClient from "./SupplierProfileClient";

export const metadata: Metadata = {
  title: "Supplier Profile — Mederti",
  description: "Set up your wholesaler profile to receive enquiries and broadcast inventory.",
};

export default function SupplierProfilePage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--app-text)" }}>
      <SiteNav />
      <SupplierProfileClient />
    </div>
  );
}
