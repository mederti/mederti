import type { Metadata } from "next";
import SiteNav from "@/app/components/landing-nav";
import OnboardingClient from "./OnboardingClient";

export const metadata: Metadata = {
  title: "Welcome to Mederti — Supplier Onboarding",
  description: "Get set up in 3 minutes — add your company, choose your territory, and start receiving buyer enquiries.",
};

export default function SupplierOnboardingPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--app-bg)" }}>
      <SiteNav />
      <OnboardingClient />
    </div>
  );
}
