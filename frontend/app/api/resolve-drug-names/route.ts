import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/security/rate-limit";

// Sit next to Supabase (ap-south-1). Hobby plan ignores this — Vercel
// dashboard sets the project default.
export const preferredRegion = "bom1";

// POST /api/resolve-drug-names
// Body: { names: string[] }
// Returns: { [name: string]: drug_id } — only names that resolved.
//
// Used by /chat to make drug names inside markdown tables (and other
// post-stream content the model didn't emit as <drug_card>) clickable.
// Resolution is best-effort case-insensitive exact match against
// drugs.generic_name. Names that don't match are simply omitted from
// the response — the renderer falls back to plain text.

const MAX_NAMES = 50;

export async function POST(req: NextRequest) {
  const limited = await enforceRateLimit(req, "bulk");
  if (limited) return limited;

  let body: { names?: unknown };
  try {
    body = (await req.json()) as { names?: unknown };
  } catch {
    return NextResponse.json({}, { status: 400 });
  }

  const raw = Array.isArray(body.names) ? body.names : [];
  const names = Array.from(
    new Set(
      raw
        .filter((n): n is string => typeof n === "string")
        .map((n) => n.trim())
        .filter((n) => n.length >= 2 && n.length <= 80 && /[a-z]/i.test(n))
    )
  ).slice(0, MAX_NAMES);

  if (names.length === 0) return NextResponse.json({});

  const sb = getSupabaseAdmin();

  // One round-trip per name, fired in parallel. Each query uses ilike
  // with no wildcards → case-insensitive exact match. Bounded to
  // MAX_NAMES so the concurrency stays sane.
  const hits = await Promise.all(
    names.map(async (name) => {
      const { data } = await sb
        .from("drugs")
        .select("id")
        .ilike("generic_name", name)
        .limit(1);
      if (data && data[0]) return [name, data[0].id as string] as const;
      return null;
    })
  );

  const map: Record<string, string> = {};
  for (const h of hits) if (h) map[h[0]] = h[1];

  return NextResponse.json(map);
}
