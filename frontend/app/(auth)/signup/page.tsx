import type { Metadata } from "next";
import { Suspense } from "react";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import SignupClient, { type SignupStats } from "./SignupClient";

export const metadata: Metadata = {
  title: "Create a free account — Mederti",
  description:
    "Sign up free to search live shortage status for any medicine, across 50+ countries and 40+ official regulators. No credit card required.",
  alternates: { canonical: "/signup" },
};

// Live numbers for the value panel next to the form. Same honest-fallback
// policy as the landing page: if a count fails we show generic copy, never a
// stale hardcoded figure.
export const revalidate = 300;

export default async function SignupPage() {
  const stats: SignupStats = { medicines: null, activeShortages: null, countries: null };
  try {
    const admin = getSupabaseAdmin();
    const [catRes, activeRes, ctyRes] = await Promise.all([
      // Planner estimate — an exact count of ~160k rows can hit statement_timeout.
      admin.from("drug_catalogue").select("id", { count: "estimated", head: true }),
      admin.from("shortage_events").select("id", { count: "exact", head: true }).eq("status", "active"),
      admin.from("data_sources").select("country_code"),
    ]);
    if (catRes.count) stats.medicines = catRes.count;
    if (activeRes.count) stats.activeShortages = activeRes.count;
    if (ctyRes.data) {
      const n = new Set(
        ctyRes.data
          .map((r: { country_code: string }) => (r.country_code || "").toUpperCase())
          .filter((c: string) => c && c !== "ZZ")
      ).size;
      if (n) stats.countries = n;
    }
  } catch {
    /* generic copy fallback */
  }

  return (
    <Suspense>
      <SignupClient stats={stats} />
    </Suspense>
  );
}
