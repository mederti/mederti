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
  // /api/og* is the social-card image. X (Twitterbot), LinkedIn, Slack etc.
  // honour robots.txt when fetching og:image, so the blanket /api/ disallow
  // made every shared link render as a bare no-image card. Allow is the
  // longer match, so it wins over the /api/ disallow.
  const publicAllow = ["/", "/medicine/", "/country/", "/regulator/", "/api/og"];

  // Crawler policy (reviewed 2026-11-11). A bot matched by a named group
  // ignores the "*" group entirely, so every named group must carry the same
  // disallow list. Two kinds of AI crawler:
  //   - Search / user-fetch agents (answer-time retrieval that cites and links
  //     the page): OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User,
  //     PerplexityBot, Perplexity-User, Bingbot (also feeds Copilot), Applebot.
  //     These are the discoverability goal — welcome on public pages.
  //   - Training crawlers: GPTBot, ClaudeBot, Google-Extended, CCBot. Already
  //     allowed (named or via "*") since the Aug 2026 SEO layer; unchanged
  //     here. Whether public pages should feed model training is an open
  //     business decision — to opt out, give this group `disallow: ["/"]`.
  //     Gated product data is unreachable to every crawler either way.
  const aiSearchAgents = [
    "OAI-SearchBot",
    "ChatGPT-User",
    "Claude-SearchBot",
    "Claude-User",
    "Claude-Web",
    "PerplexityBot",
    "Perplexity-User",
    "Bingbot",
    "Applebot",
    "GoogleOther",
  ];
  const aiTrainingCrawlers = ["GPTBot", "ClaudeBot", "Google-Extended", "CCBot"];

  return {
    rules: [
      { userAgent: "*", allow: publicAllow, disallow: gatedOrPrivate },
      { userAgent: aiSearchAgents, allow: publicAllow, disallow: gatedOrPrivate },
      { userAgent: aiTrainingCrawlers, allow: publicAllow, disallow: gatedOrPrivate },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
