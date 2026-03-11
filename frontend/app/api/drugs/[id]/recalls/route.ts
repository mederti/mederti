import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Verify drug exists
  const { data: drug } = await getSupabaseAdmin()
    .from("drugs")
    .select("id")
    .eq("id", id)
    .limit(1)
    .single();

  if (!drug) {
    return NextResponse.json({ error: `Drug '${id}' not found` }, { status: 404 });
  }

  const { data: rows } = await getSupabaseAdmin()
    .from("recalls")
    .select(
      "id, recall_id, country_code, recall_class, generic_name, brand_name, " +
      "manufacturer, announced_date, status, reason_category, press_release_url"
    )
    .eq("drug_id", id)
    .order("announced_date", { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recallRows = (rows ?? []) as any[];

  // Fetch link counts per recall
  const recallIds = recallRows.map((r) => r.id as string);
  const linkCounts: Record<string, number> = Object.fromEntries(recallIds.map((rid) => [rid, 0]));

  if (recallIds.length > 0) {
    const { data: links } = await getSupabaseAdmin()
      .from("recall_shortage_links")
      .select("recall_id")
      .in("recall_id", recallIds);

    for (const link of links ?? []) {
      linkCounts[link.recall_id] = (linkCounts[link.recall_id] ?? 0) + 1;
    }
  }

  // Compute resilience score
  const today = new Date();
  let score = 100;

  for (const r of recallRows) {
    const announced = new Date(r.announced_date);
    if (isNaN(announced.getTime())) continue;
    const ageMonths =
      (today.getFullYear() - announced.getFullYear()) * 12 +
      (today.getMonth() - announced.getMonth());

    if (ageMonths <= 12) score -= 5;
    if (r.recall_class === "I" && ageMonths <= 24) {
      score -= 15;
      if ((linkCounts[r.id] ?? 0) > 0) score -= 20;
    }
  }
  score = Math.max(0, Math.min(100, score));

  const recalls = recallRows.map((r) => ({
    id: r.id,
    recall_id: r.recall_id,
    country_code: r.country_code,
    recall_class: r.recall_class ?? null,
    generic_name: r.generic_name,
    brand_name: r.brand_name ?? null,
    manufacturer: r.manufacturer ?? null,
    announced_date: String(r.announced_date),
    status: r.status,
    reason_category: r.reason_category ?? null,
    press_release_url: r.press_release_url ?? null,
    linked_shortages: linkCounts[r.id] ?? 0,
  }));

  return NextResponse.json({
    drug_id: id,
    resilience_score: score,
    recalls,
  });
}
