import { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/drugs/", "/intelligence/", "/search"],
        disallow: [
          "/api/",
          "/account",
          "/watchlist",
          "/admin/",
          "/onboarding",
          "/auth",
          "/coming-soon",
        ],
      },
      // AI crawlers — explicit allow so they index the drug detail pages
      // and the intelligence brief.
      {
        userAgent: ["GPTBot", "Claude-Web", "ClaudeBot", "PerplexityBot", "GoogleOther", "Bingbot"],
        allow: "/",
        disallow: ["/api/", "/account", "/watchlist", "/admin/", "/onboarding"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
