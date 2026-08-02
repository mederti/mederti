import { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo";

// Keep this aligned with proxy.ts PUBLIC_PATHS: robots must only Allow what a
// logged-out crawler can actually fetch with a 200. Advertising login-gated
// paths (/drugs, /search, /intelligence) burns crawl budget on 307s and gets
// pages classified as soft-404s — the public crawl surface is the landing/
// marketing pages plus the /medicine, /country and /regulator SEO layer.
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  const gatedOrPrivate = [
    "/api/",
    "/account",
    "/watchlist",
    "/admin/",
    "/onboarding",
    "/auth",
    "/coming-soon",
    // Login-gated product surfaces (closed-funnel decision, Jul 2026)
    "/drugs/",
    "/search",
    "/intelligence",
    "/shortages",
    "/recalls",
    "/dashboard",
    "/insights",
    "/freshness",
    "/chat",
    "/ask",
    "/map",
    "/home",
    "/supplier-dashboard",
  ];
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/medicine/", "/country/", "/regulator/"],
        disallow: gatedOrPrivate,
      },
      // AI crawlers — explicitly welcome on the public data layer so ChatGPT,
      // Claude, Perplexity et al. can retrieve and cite Mederti pages.
      {
        userAgent: ["GPTBot", "Claude-Web", "ClaudeBot", "PerplexityBot", "GoogleOther", "Bingbot"],
        allow: ["/", "/medicine/", "/country/", "/regulator/"],
        disallow: gatedOrPrivate,
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
