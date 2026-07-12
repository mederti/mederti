import { Suspense } from "react";
import type { Metadata } from "next";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import SignupClient, { type SignupStats } from "./SignupClient";

export const metadata: Metadata = { title: "Sign up — Mederti" };

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
