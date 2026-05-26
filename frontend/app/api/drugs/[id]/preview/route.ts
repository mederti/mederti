import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface ShortageRow {
  shortage_id: string;
  country_code: string | null;
  severity: string | null;
  status: string;
  start_date: string | null;
  reason_category: string | null;
  data_sources: { name: string } | { name: string }[] | null;
}

interface AlternativeRow {
  alternative_drug_id: string;
  similarity_score: number | null;
  clinical_evidence_level: string | null;
  relationship_type: string | null;
  drugs: { generic_name: string } | { generic_name: string }[] | null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = getSupabaseAdmin();

  const [drugRes, shortagesRes, shortageCountRes, altsRes] = await Promise.all([
    sb
      .from("drugs")
      .select("id, generic_name, brand_names, atc_code, atc_description, drug_class")
      .eq("id", id)
      .single(),
    sb
      .from("shortage_events")
      .select("shortage_id, country_code, severity, status, start_date, reason_category, data_sources(name)")
      .eq("drug_id", id)
      .in("status", ["active", "anticipated"])
      .order("start_date", { ascending: false })
      .limit(8),
    sb
      .from("shortage_events")
      .select("severity, country_code", { count: "exact" })
      .eq("drug_id", id)
      .in("status", ["active", "anticipated"]),
    sb
      .from("drug_alternatives")
      .select("alternative_drug_id, similarity_score, clinical_evidence_level, relationship_type, drugs!drug_alternatives_alternative_drug_id_fkey(generic_name)")
      .eq("drug_id", id)
      .order("similarity_score", { ascending: false })
      .limit(4),
  ]);

  if (drugRes.error || !drugRes.data) {
    return NextResponse.json({ error: "Drug not found" }, { status: 404 });
  }

  const shortagesRaw = (shortagesRes.data ?? []) as ShortageRow[];
  const altsRaw = (altsRes.data ?? []) as AlternativeRow[];

  const pickName = <T extends { name: string }>(rel: T | T[] | null): string | null => {
    if (!rel) return null;
    return Array.isArray(rel) ? rel[0]?.name ?? null : rel.name;
  };
  const pickGeneric = <T extends { generic_name: string }>(rel: T | T[] | null): string | null => {
    if (!rel) return null;
    return Array.isArray(rel) ? rel[0]?.generic_name ?? null : rel.generic_name;
  };

  const recentShortages = shortagesRaw.map((s) => ({
    shortage_id: s.shortage_id,
    country_code: s.country_code,
    severity: s.severity,
    status: s.status,
    start_date: s.start_date,
    reason_category: s.reason_category,
    source_name: pickName(s.data_sources),
  }));

  const alternatives = altsRaw
    .map((a) => ({
      alt_drug_id: a.alternative_drug_id,
      alt_generic_name: pickGeneric(a.drugs) ?? "",
      similarity_score: a.similarity_score,
      evidence_grade: a.clinical_evidence_level,
    }))
    .filter((a) => a.alt_generic_name);

  const allActive = (shortageCountRes.data ?? []) as Array<{ severity: string | null; country_code: string | null }>;
  const severityCount: Record<string, number> = {};
  const countries = new Set<string>();
  for (const s of allActive) {
    if (s.severity) severityCount[s.severity] = (severityCount[s.severity] ?? 0) + 1;
    if (s.country_code) countries.add(s.country_code);
  }

  return NextResponse.json({
    drug: drugRes.data,
    activeShortageCount: shortageCountRes.count ?? allActive.length,
    severityCount,
    countries: [...countries],
    recentShortages: recentShortages.slice(0, 5),
    alternatives,
  });
}
