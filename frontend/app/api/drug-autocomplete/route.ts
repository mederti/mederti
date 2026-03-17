import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export interface AutocompleteItem {
  id: string;
  type: "drug" | "product";
  name: string;
  form: string | null;
  strength: string | null;
  severity: "critical" | "high" | "active" | null;
  shortageCount: number;
  href: string;
}

interface AutocompleteResponse {
  q: string;
  items: AutocompleteItem[];
}

function worstSeverity(
  severities: (string | null)[],
): AutocompleteItem["severity"] {
  if (severities.some((s) => s === "critical")) return "critical";
  if (severities.some((s) => s === "high")) return "high";
  if (severities.length > 0) return "active";
  return null;
}

function sortScore(name: string, q: string, hasShortage: boolean): number {
  const n = name.toLowerCase();
  const base = hasShortage ? 0 : 10000;
  if (n === q) return base;
  if (n.startsWith(q)) return base + 100;
  return base + 200;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 8), 1),
    20,
  );

  if (!q || q.length < 2) {
    return NextResponse.json<AutocompleteResponse>({ q: q ?? "", items: [] });
  }

  const sb = getSupabaseAdmin();
  const term = `%${q}%`;
  const qLower = q.toLowerCase();

  // Round 1: search drugs, products, and catalogue in parallel
  const [drugsRes, productsRes, catalogueRes] = await Promise.all([
    sb
      .from("drugs")
      .select("id, generic_name, dosage_forms, strengths")
      .ilike("generic_name", term)
      .limit(12),
    sb
      .from("drug_products")
      .select("id, product_name, dosage_form, strength, country")
      .ilike("product_name", term)
      .limit(12),
    sb
      .from("drug_catalogue")
      .select("id, drug_id, generic_name, brand_name, dosage_form, strength, source_country, source_name")
      .ilike("generic_name", term)
      .limit(12),
  ]);

  const drugRows = drugsRes.data ?? [];
  const productRows = productsRes.data ?? [];
  const catalogueRows = catalogueRes.data ?? [];

  // Round 2: fetch shortage data in parallel
  const drugIds = drugRows.map((d) => d.id);
  const productIds = productRows.map((p) => p.id);

  const [shortagesRes, availRes] = await Promise.all([
    drugIds.length > 0
      ? sb
          .from("shortage_events")
          .select("drug_id, severity")
          .in("drug_id", drugIds)
          .in("status", ["active", "anticipated"])
      : Promise.resolve({ data: [] as { drug_id: string; severity: string }[] }),
    productIds.length > 0
      ? sb
          .from("drug_availability")
          .select("product_id, severity, status")
          .in("product_id", productIds)
          .neq("status", "available")
      : Promise.resolve({ data: [] as { product_id: string; severity: string; status: string }[] }),
  ]);

  const shortages = shortagesRes.data ?? [];
  const availability = availRes.data ?? [];

  // Build shortage maps
  const drugShortageMap = new Map<string, string[]>();
  for (const s of shortages) {
    const arr = drugShortageMap.get(s.drug_id) ?? [];
    arr.push(s.severity);
    drugShortageMap.set(s.drug_id, arr);
  }

  const productAvailMap = new Map<string, string[]>();
  for (const a of availability) {
    const arr = productAvailMap.get(a.product_id) ?? [];
    arr.push(a.severity);
    productAvailMap.set(a.product_id, arr);
  }

  // Build items from drugs
  const items: AutocompleteItem[] = [];
  const coveredNames = new Set<string>();

  for (const d of drugRows) {
    const sevs = drugShortageMap.get(d.id) ?? [];
    coveredNames.add(d.generic_name.toLowerCase());
    items.push({
      id: d.id,
      type: "drug",
      name: d.generic_name,
      form: d.dosage_forms?.[0] ?? null,
      strength: d.strengths?.[0] ?? null,
      severity: worstSeverity(sevs),
      shortageCount: sevs.length,
      href: `/drugs/${d.id}`,
    });
  }

  // Add products not already covered by drug rows
  for (const p of productRows) {
    if (coveredNames.has(p.product_name.toLowerCase())) continue;
    const sevs = productAvailMap.get(p.id) ?? [];
    coveredNames.add(p.product_name.toLowerCase());
    items.push({
      id: p.id,
      type: "product",
      name: p.product_name,
      form: p.dosage_form ?? null,
      strength: p.strength ?? null,
      severity: worstSeverity(sevs),
      shortageCount: sevs.length,
      href: `/search?q=${encodeURIComponent(p.product_name)}`,
    });
  }

  // Add catalogue entries not already covered
  for (const c of catalogueRows) {
    const name = c.generic_name?.toLowerCase();
    if (!name || coveredNames.has(name)) continue;
    coveredNames.add(name);
    const href = c.drug_id ? `/drugs/${c.drug_id}` : `/search?q=${encodeURIComponent(c.generic_name)}`;
    items.push({
      id: c.id,
      type: "drug",
      name: c.generic_name,
      form: c.dosage_form ?? null,
      strength: c.strength ?? null,
      severity: null,
      shortageCount: 0,
      href,
    });
  }

  // Sort: shortage items first, then exact > starts-with > contains, then alphabetical
  items.sort((a, b) => {
    const sa = sortScore(a.name, qLower, a.shortageCount > 0);
    const sb = sortScore(b.name, qLower, b.shortageCount > 0);
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });

  return NextResponse.json<AutocompleteResponse>({
    q,
    items: items.slice(0, limit),
  });
}
