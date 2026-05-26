import { NextRequest } from "next/server";
import {
  fetchDrugDetail,
  fetchManufacturersForDrug,
  fetchProductsForDrug,
  fetchRecallsForDrug,
  fetchShortageHistory,
  fetchSubstitutesFor,
  fetchSuppliersForDrugs,
} from "@/lib/chat/tools";
import type { DrugDetailBundle } from "@/lib/chat/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!id || !UUID_RE.test(id)) {
    return Response.json(
      { error: "Invalid drug id" } satisfies Partial<DrugDetailBundle>,
      { status: 400 }
    );
  }

  const url = new URL(req.url);
  const country = url.searchParams.get("country") || undefined;

  try {
    const [drug, substitutes, recalls, manufacturers, history, products] = await Promise.all([
      fetchDrugDetail(id),
      fetchSubstitutesFor(id, country, 8),
      fetchRecallsForDrug(id, 8),
      fetchManufacturersForDrug(id, { country, limit: 12 }),
      fetchShortageHistory(id),
      fetchProductsForDrug(id, { country, limit: 200 }),
    ]);

    if (!drug) {
      return Response.json(
        { error: "Drug not found" } satisfies Partial<DrugDetailBundle>,
        { status: 404 }
      );
    }

    const allDrugIds = [id, ...substitutes.map((s) => s.drug_id)];
    const supplierMap = await fetchSuppliersForDrugs(allDrugIds, country);
    const suppliers = supplierMap.get(id) ?? [];

    const substitutesWithSuppliers = substitutes.map((s) => ({
      ...s,
      suppliers: supplierMap.get(s.drug_id) ?? [],
    }));

    return Response.json(
      {
        drug,
        substitutes: substitutesWithSuppliers,
        recalls,
        suppliers,
        manufacturers,
        history,
        products,
      } satisfies DrugDetailBundle,
      { headers: { "Cache-Control": "private, max-age=15" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[drug/[id]] error:", msg);
    return Response.json(
      { error: msg } satisfies Partial<DrugDetailBundle>,
      { status: 500 }
    );
  }
}
