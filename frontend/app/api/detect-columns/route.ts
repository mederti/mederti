import { NextRequest, NextResponse } from "next/server";

/* ── Types ── */

interface DetectRequest {
  headers: string[];
  sampleRows: string[][];
}

interface DetectResponse {
  drugCol: string | null;
  qtyOrderedCol: string | null;
  qtyBackorderedCol: string | null;
  supplierCol: string | null;
  method: "ai" | "fallback";
}

/* ── Fallback alias lists (priority order) ── */

const DRUG_ALIASES = [
  "description", "drug name", "medicine", "product", "item",
  "product name", "drug", "drug_name", "medicine_name", "product_name",
  "generic_name", "generic", "active_ingredient", "ingredient",
  "medication", "med", "name",
];

const QTY_ORDERED_ALIASES = [
  "qty ordered", "quantity", "qty", "order qty", "quantity ordered",
  "qty_ordered", "order_qty", "amount", "count", "units",
];

const QTY_BACKORDERED_ALIASES = [
  "qty backordered", "backordered", "back order", "bo qty",
  "qty_backordered", "backorder", "back_order", "bo_qty",
  "unfulfilled", "qty unfulfilled",
];

const SUPPLIER_ALIASES = [
  "vendor name", "supplier", "manufacturer", "vendor",
  "vendor_name", "mfr", "supplier_name", "manufacturer_name",
];

/* ── Helpers ── */

function norm(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
}

function detectByAlias(headers: string[], aliases: string[]): string | null {
  const normed = headers.map(norm);
  // Exact match
  for (const alias of aliases) {
    const a = norm(alias);
    const idx = normed.indexOf(a);
    if (idx >= 0) return headers[idx];
  }
  // Partial (contains) match
  for (const alias of aliases) {
    const a = norm(alias);
    const idx = normed.findIndex((h) => h.includes(a) || a.includes(h));
    if (idx >= 0) return headers[idx];
  }
  return null;
}

/** If no alias matches for drug column, pick the column with longest average string length. */
function detectByLength(
  headers: string[],
  sampleRows: string[][],
  excludeCols: Set<string>,
): string | null {
  let best = "";
  let bestAvg = 0;
  for (let c = 0; c < headers.length; c++) {
    if (excludeCols.has(headers[c])) continue;
    const lengths = sampleRows.map((row) => (row[c] ?? "").trim().length);
    const avg = lengths.reduce((a, b) => a + b, 0) / Math.max(lengths.length, 1);
    if (avg > bestAvg) {
      bestAvg = avg;
      best = headers[c];
    }
  }
  return best || null;
}

function fallback(headers: string[], sampleRows: string[][]): DetectResponse {
  const qtyOrderedCol = detectByAlias(headers, QTY_ORDERED_ALIASES);
  const qtyBackorderedCol = detectByAlias(headers, QTY_BACKORDERED_ALIASES);
  const supplierCol = detectByAlias(headers, SUPPLIER_ALIASES);

  let drugCol = detectByAlias(headers, DRUG_ALIASES);
  if (!drugCol) {
    // Fallback: pick column with longest average text
    const used = new Set(
      [qtyOrderedCol, qtyBackorderedCol, supplierCol].filter(Boolean) as string[],
    );
    drugCol = detectByLength(headers, sampleRows, used);
  }

  return { drugCol, qtyOrderedCol, qtyBackorderedCol, supplierCol, method: "fallback" };
}

/* ── Route handler ── */

export async function POST(req: NextRequest) {
  let body: DetectRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { headers, sampleRows } = body;
  if (!headers || !Array.isArray(headers) || headers.length === 0) {
    return NextResponse.json({ error: "headers array required" }, { status: 400 });
  }

  /* ── Try AI detection ── */
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey });

      const userMessage = JSON.stringify({ headers, rows: (sampleRows ?? []).slice(0, 2) });

      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 200,
        system:
          "You are a pharmaceutical data parser. Given spreadsheet headers and sample rows from a hospital procurement or inventory file, identify which column contains: (1) the drug or product name, (2) quantity ordered, (3) quantity backordered or unfulfilled, (4) supplier or vendor name. Respond only in JSON with no preamble or markdown: {\"drugCol\": string, \"qtyCol\": string, \"backorderCol\": string, \"supplierCol\": string}. Use null if a field cannot be identified.",
        messages: [{ role: "user", content: userMessage }],
      });

      // Extract text from response
      const text =
        response.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("") ?? "";

      // Parse JSON — handle possible markdown wrapping
      const jsonStr = text.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(jsonStr) as {
        drugCol?: string | null;
        qtyCol?: string | null;
        backorderCol?: string | null;
        supplierCol?: string | null;
      };

      // Validate that returned column names actually exist in headers
      const headerSet = new Set(headers);
      const validCol = (col: string | null | undefined): string | null =>
        col && headerSet.has(col) ? col : null;

      const result: DetectResponse = {
        drugCol: validCol(parsed.drugCol),
        qtyOrderedCol: validCol(parsed.qtyCol),
        qtyBackorderedCol: validCol(parsed.backorderCol),
        supplierCol: validCol(parsed.supplierCol),
        method: "ai",
      };

      // If AI couldn't find drug column, supplement with fallback
      if (!result.drugCol) {
        const fb = fallback(headers, sampleRows ?? []);
        result.drugCol = fb.drugCol;
        if (!result.qtyOrderedCol) result.qtyOrderedCol = fb.qtyOrderedCol;
        if (!result.qtyBackorderedCol) result.qtyBackorderedCol = fb.qtyBackorderedCol;
        if (!result.supplierCol) result.supplierCol = fb.supplierCol;
      }

      return NextResponse.json(result);
    } catch (err) {
      console.warn("[detect-columns] AI detection failed, using fallback:", err);
    }
  }

  /* ── Fallback ── */
  return NextResponse.json(fallback(headers, sampleRows ?? []));
}
