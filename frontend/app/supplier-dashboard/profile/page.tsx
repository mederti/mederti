import type { Metadata } from "next";
import AppShell from "@/app/components/v1/AppShell";
import SupplierProfileClient from "./SupplierProfileClient";

export const metadata: Metadata = {
  title: "Supplier Profile — Mederti",
  description: "Set up your wholesaler profile to receive enquiries and broadcast inventory.",
};

export default function SupplierProfilePage() {
  return (
    <AppShell contentClassName="flush base-type">
      <div style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--app-text)" }}>
        <SupplierProfileClient />
      </div>
    </AppShell>
  );
}
