import type { Metadata } from "next";
import SiteNav from "@/app/components/landing-nav";
import VerificationClient from "./VerificationClient";

export const metadata: Metadata = {
  title: "Get Verified — Mederti Supplier Dashboard",
  description: "Submit your wholesale licence and certifications to earn the Verified Supplier badge.",
};

export default function VerificationPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--app-bg)" }}>
      <SiteNav />
      <VerificationClient />
    </div>
  );
}
