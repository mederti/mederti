import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);

  // Total active
  const { count: totalActive } = await getSupabaseAdmin()
    .from("recalls")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");

  // Class I active
  const { count: classICount } = await getSupabaseAdmin()
    .from("recalls")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .eq("recall_class", "I");

  // New this month
  const { count: newThisMonth } = await getSupabaseAdmin()
    .from("recalls")
    .select("id", { count: "exact", head: true })
    .gte("announced_date", monthStart);

  // By country (active, up to 500)
  const { data: countryRows } = await getSupabaseAdmin()
    .from("recalls")
    .select("country_code")
    .eq("status", "active")
    .limit(500);

  const countryCounts: Record<string, number> = {};
  for (const r of countryRows ?? []) {
    const cc = r.country_code ?? "XX";
    countryCounts[cc] = (countryCounts[cc] ?? 0) + 1;
  }
  const byCountry = Object.entries(countryCounts)
    .map(([country_code, count]) => ({ country_code, count }))
    .sort((a, b) => b.count - a.count);

  // By class (active, up to 500)
  const { data: classRows } = await getSupabaseAdmin()
    .from("recalls")
    .select("recall_class")
    .eq("status", "active")
    .limit(500);

  const classCounts: Record<string, number> = {};
  for (const r of classRows ?? []) {
    const rc = r.recall_class ?? "Unknown";
    classCounts[rc] = (classCounts[rc] ?? 0) + 1;
  }

  return NextResponse.json({
    total_active: totalActive ?? 0,
    class_i_count: classICount ?? 0,
    new_this_month: newThisMonth ?? 0,
    by_country: byCountry,
    by_class: classCounts,
  });
}
