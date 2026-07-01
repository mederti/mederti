import type { Metadata } from "next";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";
import SupplierDirectoryClient from "./SupplierDirectoryClient";
import { canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Pharmaceutical Supplier Directory — Mederti",
  description:
    "Browse verified pharmaceutical wholesalers and distributors across major markets worldwide. Find suppliers for drugs in shortage with real-time stock visibility.",
  alternates: {
    canonical: canonicalUrl("/suppliers/directory"),
  },
  openGraph: {
    title: "Pharmaceutical Supplier Directory",
    description: "Verified wholesalers and distributors across major markets worldwide.",
    url: canonicalUrl("/suppliers/directory"),
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
