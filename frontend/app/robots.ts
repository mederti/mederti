import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/account", "/watchlist"],
      },
      {
        userAgent: ["GPTBot", "Claude-Web", "PerplexityBot", "GoogleOther", "Bingbot"],
        allow: "/",
      },
    ],
    sitemap: "https://mederti.vercel.app/sitemap.xml",
  };
}
