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

  const { data: rows, error } = await getSupabaseAdmin()
    .from("drug_alternatives")
    .select(
      "alternative_drug_id, relationship_type, " +
      "clinical_evidence_level, similarity_score, " +
      "dose_conversion_notes, availability_note, " +
      "drugs!drug_alternatives_alternative_drug_id_fkey(generic_name, brand_names)"
    )
    .eq("drug_id", id)
    .eq("is_approved", true)
    .order("similarity_score", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = ((rows ?? []) as any[]).map((r) => {
    const drugData = r.drugs ?? {};
    return {
      alternative_drug_id: r.alternative_drug_id,
      alternative_generic_name: drugData.generic_name ?? "",
      alternative_brand_names: drugData.brand_names ?? [],
      relationship_type: r.relationship_type ?? "",
      clinical_evidence_level: r.clinical_evidence_level ?? null,
      similarity_score: r.similarity_score ?? null,
      dose_conversion_notes: r.dose_conversion_notes ?? null,
      availability_note: r.availability_note ?? null,
    };
  });

  return NextResponse.json(results);
}
