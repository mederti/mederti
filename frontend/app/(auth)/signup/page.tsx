import type { Metadata } from "next";
import { Suspense } from "react";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { COVERAGE_COPY, liveCoverage } from "@/lib/coverage";
import SignupClient, { type SignupStats } from "./SignupClient";

export const metadata: Metadata = {
  title: "Create a free account — Mederti",
  description:
    `Sign up free to search live shortage status for any medicine, across ${COVERAGE_COPY.countries} and ${COVERAGE_COPY.regulators}. No credit card required.`,
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
      admin.from("shortage_events").select("id", { count: "exact", head: true }).eq("status", "active").or("synthetic.is.null,synthetic.eq.false"),
      liveCoverage(),
    ]);
    if (catRes.count) stats.medicines = catRes.count;
    if (activeRes.count) stats.activeShortages = activeRes.count;
    if (ctyRes?.countries) stats.countries = ctyRes.countries;
  } catch {
    /* generic copy fallback */
  }

  return (
    <Suspense>
      <SignupClient stats={stats} />
    </Suspense>
  );
}
