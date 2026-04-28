import type { Metadata } from "next";
import SiteNav from "@/app/components/landing-nav";
import SupplierInventoryClient from "./SupplierInventoryClient";

export const metadata: Metadata = {
  title: "Inventory Broadcast — Mederti",
  description: "Post drugs you have in stock and get matched to buyers in shortage markets.",
};

export default function SupplierInventoryPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--app-text)" }}>
      <SiteNav />
      <SupplierInventoryClient />
    </div>
  );
}
