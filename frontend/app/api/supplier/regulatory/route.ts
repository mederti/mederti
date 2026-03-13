import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/* ── FDA recent approvals (same logic as market-data route) ── */
interface FdaApproval {
  drugName: string;
  applicationType: string;
  status: string;
  date: string;
  url: string;
}

async function fetchFdaApprovals(): Promise<FdaApproval[]> {
  try {
    const url =
      "https://api.fda.gov/drug/drugsfda.json?search=submissions.submission_type:ORIG+AND+submissions.submission_status:AP&sort=submissions.submission_status_date:desc&limit=8";
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const json = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (json.results ?? []).slice(0, 8).map((r: any) => {
      const sub = r.submissions?.[0] ?? {};
      const products = r.products ?? [];
      const brandName = products[0]?.brand_name ?? "Unknown";
      const appType = r.application_number?.startsWith("NDA")
        ? "NDA"
        : r.application_number?.startsWith("ANDA")
          ? "ANDA"
          : r.application_number?.startsWith("BLA")
            ? "BLA"
            : r.application_number?.slice(0, 3) ?? "NDA";
      return {
        drugName: brandName,
        applicationType: appType,
        status: sub.submission_status === "AP" ? "Approved" : sub.submission_status ?? "Pending",
        date: sub.submission_status_date
          ? `${sub.submission_status_date.slice(0, 4)}-${sub.submission_status_date.slice(4, 6)}-${sub.submission_status_date.slice(6, 8)}`
          : "",
        url: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${(r.application_number ?? "").replace(/\D/g, "")}`,
      };
    });
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    // Parallel: FDA approvals + active data sources with shortage counts
    const [fdaApprovals, sourcesRes] = await Promise.all([
      fetchFdaApprovals(),
      supabase
        .from("data_sources")
        .select("id, name, country_code, url, source_type, last_scraped_at, is_active")
        .eq("is_active", true)
        .order("last_scraped_at", { ascending: false })
        .limit(30),
    ]);

    const sources = sourcesRes.data ?? [];

    // Get active shortage counts per source country
    const countryCodes: string[] = [...new Set(sources.map((s: { country_code: string | null }) => s.country_code).filter(Boolean) as string[])];

    let countByCountry: Record<string, number> = {};
    if (countryCodes.length > 0) {
      const { data: shortages } = await supabase
        .from("shortage_events")
        .select("country_code")
        .in("status", ["active", "anticipated"])
        .in("country_code", countryCodes);

      for (const s of shortages ?? []) {
        const cc = (s as { country_code: string }).country_code;
        countByCountry[cc] = (countByCountry[cc] ?? 0) + 1;
      }
    }

    const activeSourceUpdates = sources.slice(0, 15).map((s: {
      name: string; country_code: string | null; last_scraped_at: string | null; url: string;
    }) => ({
      source_name: s.name,
      country_code: s.country_code ?? "XX",
      last_scraped: s.last_scraped_at ?? "",
      source_url: s.url,
      shortage_count_active: countByCountry[s.country_code ?? ""] ?? 0,
    }));

    return NextResponse.json({
      fda_approvals: fdaApprovals,
      active_source_updates: activeSourceUpdates,
    });
  } catch (err) {
    console.error("supplier/regulatory error:", err);
    return NextResponse.json(
      { fda_approvals: [], active_source_updates: [], error: "Failed to fetch regulatory signals" },
      { status: 500 },
    );
  }
}
