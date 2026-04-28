import type { Metadata } from "next";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";
import SupplierDirectoryClient from "./SupplierDirectoryClient";

export const metadata: Metadata = {
  title: "Pharmaceutical Supplier Directory — Mederti",
  description:
    "Browse verified pharmaceutical wholesalers and distributors across 22 countries. Find suppliers for drugs in shortage with real-time stock visibility.",
  alternates: {
    canonical: "https://mederti.vercel.app/suppliers/directory",
  },
  openGraph: {
    title: "Pharmaceutical Supplier Directory",
    description: "Verified wholesalers and distributors across 22 countries.",
    url: "https://mederti.vercel.app/suppliers/directory",
    type: "website",
  },
};

export default function SuppliersDirectoryPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--app-bg)", display: "flex", flexDirection: "column" }}>
      <SiteNav />
      <SupplierDirectoryClient />
      <SiteFooter />
    </div>
  );
}
