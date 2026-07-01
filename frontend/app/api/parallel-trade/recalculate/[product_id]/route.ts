import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { scoreMatch, type DrugFacts } from "@/lib/parallel-trade/score";

export const dynamic = "force-dynamic";

/**
 * POST /api/parallel-trade/recalculate/[product_id]
 *
 * Re-scores the existing parallel-trade matches for a drug against its CURRENT
 * facts (brand_names / strengths / dosage_forms). Use after enriching a drug's
 * metadata — confidence can rise (e.g. an INN-only 0.50 becomes 0.90 once we
 * learn the strength + form) without re-scraping.
 *
 * This does NOT re-resolve licences from scratch (that's the connector's job at
 * ingest). It only recomputes confidence/basis for pairs that already exist.
 * Canonical scoring lives in backend/scrapers/parallel_trade/matching.py — the
 * TS port in lib/parallel-trade/score.ts mirrors it.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ product_id: string }> }
) {
  const { product_id } = await ctx.params;
  if (!product_id) {
    return NextResponse.json({ error: "Missing product_id" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const drugRes = await admin
    .from("drugs")
    .select("id, generic_name, brand_names, strengths, dosage_forms")
    .eq("id", product_id)
    .maybeSingle();
  if (drugRes.error || !drugRes.data) {
    return NextResponse.json({ error: "Drug not found" }, { status: 404 });
  }
  const d = drugRes.data as {
    id: string; generic_name: string; brand_names: string[] | null;
    strengths: string[] | null; dosage_forms: string[] | null;
  };
  const facts: DrugFacts = {
    generic_name: d.generic_name,
    brand_names: d.brand_names,
    strengths: d.strengths,
    dosage_forms: d.dosage_forms,
  };

  const matchRes = await admin
    .from("product_parallel_trade_matches")
    .select("id, confidence, review_state, parallel_trade_licences(brand_name, strength, dosage_form, pack_size, reference_ma_number)")
    .eq("drug_id", product_id)
    .limit(2000);
  if (matchRes.error) {
    return NextResponse.json({ error: matchRes.error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    confidence: number;
    review_state: string;
    parallel_trade_licences: {
      brand_name: string | null; strength: string | null;
      dosage_form: string | null; pack_size: string | null;
      reference_ma_number: string | null;
    } | null;
  };
  const rows = (matchRes.data ?? []) as unknown as Row[];

  let updated = 0;
  const changes: Array<{ id: string; from: number; to: number }> = [];
  for (const row of rows) {
    if (!row.parallel_trade_licences) continue;
    const { confidence, basis } = scoreMatch(row.parallel_trade_licences, facts);
    if (Number(confidence) !== Number(row.confidence)) {
      const { error } = await admin
        .from("product_parallel_trade_matches")
        .update({ confidence, match_basis: basis })
        .eq("id", row.id);
      if (!error) {
        updated += 1;
        changes.push({ id: row.id, from: Number(row.confidence), to: confidence });
      }
    }
  }

  return NextResponse.json({
    drug_id: product_id,
    matches_evaluated: rows.length,
    matches_updated: updated,
    changes,
  });
}
