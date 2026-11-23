import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { COUNTRY_NAMES } from "@/lib/geo/country-names";
import { countryNoticesPage } from "@/lib/country-profile";

// Search + paging for a country's open shortage notices. Backs the "Is your
// medicine short in <country>?" box and "Show more" on the country page.
// Same public, summary-level fields the page already renders.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const limited = await enforceRateLimit(req, "search");
  if (limited) return limited;

  const code = (await params).code.toUpperCase();
  if (!COUNTRY_NAMES[code]) return NextResponse.json({ error: "Unknown country" }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  try {
    const page = await countryNoticesPage(code, {
      q: sp.get("q") ?? undefined,
      severity: sp.get("severity") ?? undefined,
      offset: Number(sp.get("offset") ?? 0) || 0,
    });
    return NextResponse.json(page, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch {
    return NextResponse.json({ error: "Could not load notices" }, { status: 500 });
  }
}
