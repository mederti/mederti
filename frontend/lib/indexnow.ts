/**
 * IndexNow — push-based URL submission for Bing (also Yandex, Seznam, Naver).
 *
 * Bing leans on IndexNow far more than Google does: pushed URLs are typically
 * crawled within hours instead of whenever Bingbot next reads the sitemap.
 * That matters for shortage pages, which go stale in days.
 *
 * Setup: set INDEXNOW_KEY (8–128 chars of [a-zA-Z0-9-]) in Vercel. The key is
 * served at /indexnow-key.txt (root-level, so it authorises every URL on the
 * host) and passed as keyLocation on each submission.
 */
import { siteUrl } from "@/lib/seo";

const ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS_PER_REQUEST = 10_000; // protocol limit

export function indexNowKey(): string | null {
  const key = process.env.INDEXNOW_KEY?.trim();
  return key && /^[a-zA-Z0-9-]{8,128}$/.test(key) ? key : null;
}

export interface IndexNowResult {
  submitted: number;
  batches: Array<{ status: number; count: number }>;
}

export async function submitToIndexNow(urls: string[]): Promise<IndexNowResult> {
  const key = indexNowKey();
  if (!key) throw new Error("INDEXNOW_KEY not configured");
  const base = siteUrl();
  const host = new URL(base).host;
  // Only URLs on our own host are accepted; drop anything else defensively.
  const list = Array.from(new Set(urls)).filter((u) => {
    try { return new URL(u).host === host; } catch { return false; }
  });

  const batches: IndexNowResult["batches"] = [];
  for (let i = 0; i < list.length; i += MAX_URLS_PER_REQUEST) {
    const urlList = list.slice(i, i + MAX_URLS_PER_REQUEST);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key, keyLocation: `${base}/indexnow-key.txt`, urlList }),
    });
    batches.push({ status: res.status, count: urlList.length });
  }
  return { submitted: list.length, batches };
}
