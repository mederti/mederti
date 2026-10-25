import type { Metadata } from "next";
import AppShell from "@/app/components/v1/AppShell";
import OnboardingClient from "./OnboardingClient";

export const metadata: Metadata = {
  title: "Welcome to Mederti — Supplier Onboarding",
  description: "Get set up in 3 minutes — add your company, choose your territory, and start receiving buyer enquiries.",
};

export default function SupplierOnboardingPage() {
  return (
    <AppShell contentClassName="flush">
      <div style={{ minHeight: "100vh", background: "var(--app-bg)" }}>
        <OnboardingClient />
      </div>
    </AppShell>
  );
}
