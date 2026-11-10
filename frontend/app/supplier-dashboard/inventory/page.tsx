import type { Metadata } from "next";
import AppShell from "@/app/components/v1/AppShell";
import SupplierInventoryClient from "./SupplierInventoryClient";

export const metadata: Metadata = {
  title: "Inventory Broadcast — Mederti",
  description: "Post drugs you have in stock and get matched to buyers in shortage markets.",
};

export default function SupplierInventoryPage() {
  return (
    <AppShell contentClassName="flush base-type">
      <div style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--app-text)" }}>
        <SupplierInventoryClient />
      </div>
    </AppShell>
  );
}
