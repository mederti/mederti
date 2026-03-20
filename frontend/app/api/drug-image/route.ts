import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/drug-image?name=amoxicillin
 *
 * Looks up a product label/package image from DailyMed (NIH).
 * Returns { imageUrl, title } or { imageUrl: null } if not found.
 * Cached in-memory for 24 hours to avoid hammering DailyMed.
 */

const cache = new Map<string, { imageUrl: string | null; title: string | null; ts: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name")?.trim();
  if (!name) {
    return NextResponse.json({ imageUrl: null }, { status: 400 });
  }

  const key = name.toLowerCase();

  // Check cache
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json({ imageUrl: cached.imageUrl, title: cached.title, cached: true });
  }

  try {
    // Step 1: Search DailyMed for the drug name
    const searchUrl = `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name=${encodeURIComponent(name)}&pagesize=5`;
    const searchResp = await fetch(searchUrl, { signal: AbortSignal.timeout(8000) });

    if (!searchResp.ok) {
      cache.set(key, { imageUrl: null, title: null, ts: Date.now() });
      return NextResponse.json({ imageUrl: null });
    }

    const searchData = await searchResp.json();
    const spls = searchData?.data ?? [];

    if (spls.length === 0) {
      cache.set(key, { imageUrl: null, title: null, ts: Date.now() });
      return NextResponse.json({ imageUrl: null });
    }

    // Step 2: Try each SPL until we find one with a product image
    for (const spl of spls) {
      const mediaUrl = `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/${spl.setid}/media.json`;
      const mediaResp = await fetch(mediaUrl, { signal: AbortSignal.timeout(5000) });

      if (!mediaResp.ok) continue;

      const mediaData = await mediaResp.json();
      const images = mediaData?.data?.media ?? [];

      // Find a product image (skip structural formula images)
      const productImage = images.find(
        (img: { mime_type: string; name: string; url: string }) =>
          img.mime_type.startsWith("image/") &&
          !img.name.toLowerCase().includes("-str") &&
          !img.name.toLowerCase().includes("structure") &&
          !img.name.toLowerCase().includes("formula")
      );

      if (productImage) {
        const result = { imageUrl: productImage.url, title: spl.title };
        cache.set(key, { ...result, ts: Date.now() });
        return NextResponse.json(result);
      }
    }

    // No images found in any SPL
    cache.set(key, { imageUrl: null, title: null, ts: Date.now() });
    return NextResponse.json({ imageUrl: null });
  } catch (err) {
    console.error("Drug image lookup failed:", err);
    return NextResponse.json({ imageUrl: null });
  }
}
