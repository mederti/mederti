import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const DRUG_COLS =
  "id, generic_name, brand_names, atc_code, atc_description, " +
  "drug_class, dosage_forms, strengths, routes_of_administration, " +
  "therapeutic_category, is_controlled_substance";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data: rawData, error } = await getSupabaseAdmin()
    .from("drugs")
    .select(DRUG_COLS)
    .eq("id", id)
    .limit(1)
    .single();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = rawData as any;

  if (error || !data) {
    return NextResponse.json({ error: `Drug '${id}' not found` }, { status: 404 });
  }

  return NextResponse.json({
    drug_id: data.id,
    generic_name: data.generic_name,
    brand_names: data.brand_names ?? [],
    atc_code: data.atc_code ?? null,
    atc_description: data.atc_description ?? null,
    drug_class: data.drug_class ?? null,
    dosage_forms: data.dosage_forms ?? [],
    strengths: data.strengths ?? [],
    routes_of_administration: data.routes_of_administration ?? [],
    therapeutic_category: data.therapeutic_category ?? null,
    is_controlled_substance: data.is_controlled_substance ?? null,
  });
}
