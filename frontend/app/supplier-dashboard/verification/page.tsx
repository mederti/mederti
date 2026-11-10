import type { Metadata } from "next";
import AppShell from "@/app/components/v1/AppShell";
import VerificationClient from "./VerificationClient";

export const metadata: Metadata = {
  title: "Get Verified — Mederti Supplier Dashboard",
  description: "Submit your wholesale licence and certifications to earn the Verified Supplier badge.",
};

export default function VerificationPage() {
  return (
    <AppShell contentClassName="flush base-type">
      <div style={{ minHeight: "100vh", background: "var(--app-bg)" }}>
        <VerificationClient />
      </div>
    </AppShell>
  );
}
