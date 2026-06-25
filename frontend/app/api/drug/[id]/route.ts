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
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { computeTradePrice } from "@/lib/trade-price";
import type { DrugDetailBundle } from "@/lib/chat/types";
import { recordDemandSignal } from "@/lib/demand-signal";
import { getClientIp } from "@/lib/chat/rate-limit";

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
    // Compute trade price in parallel with everything else. Returns null when
    // there's no supplier_inventory row for the home country — the chat
    // surfaces hide the price tile gracefully in that case.
    const supabase = getSupabaseAdmin();
    const homeCountry = (country || "AU").toUpperCase();

    const [drug, substitutes, recalls, manufacturers, history, products, tradePrice] = await Promise.all([
      fetchDrugDetail(id),
      fetchSubstitutesFor(id, country, 8),
      fetchRecallsForDrug(id, 8),
      fetchManufacturersForDrug(id, { country, limit: 12 }),
      fetchShortageHistory(id),
      fetchProductsForDrug(id, { country, limit: 200 }),
      computeTradePrice(supabase, id, homeCountry).catch((err) => {
        console.error("[drug/[id]] computeTradePrice failed:", err);
        return null;
      }),
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

    // Demand-signal instrumentation — drug_view signal (Sprint 4 PR 1).
    recordDemandSignal({
      signal_type: "drug_view",
      drug_id: id,
      country_code: homeCountry,
      identifier: getClientIp(req),
    });

    return Response.json(
      {
        drug,
        substitutes: substitutesWithSuppliers,
        recalls,
        suppliers,
        manufacturers,
        history,
        products,
        tradePrice,
      } satisfies DrugDetailBundle,
      // Shortage/supplier data refreshes on a 4h+ scraper cadence, so a 15s
      // window forced this 7-query bundle to re-run almost every request. 2 min
      // + stale-while-revalidate keeps it fresh enough while absorbing repeat hits.
      { headers: { "Cache-Control": "private, max-age=120, stale-while-revalidate=600" } }
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
