import Parser from "rss-parser";

export interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  color: string;
  description: string;
}

const FEEDS = [
  {
    url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/drugs/rss.xml",
    source: "FDA",
    color: "#1d4ed8",
  },
  {
    url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medwatch/rss.xml",
    source: "MedWatch",
    color: "#dc2626",
  },
  {
    url: "https://www.who.int/rss-feeds/news-english.xml",
    source: "WHO",
    color: "#0891b2",
  },
  {
    url: "https://www.ema.europa.eu/en/rss.xml",
    source: "EMA",
    color: "#7c3aed",
  },
];

export async function fetchNews(maxItems = 14): Promise<NewsItem[]> {
  const parser = new Parser({ timeout: 8000 });

  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const parsed = await parser.parseURL(feed.url);
      return parsed.items.slice(0, 6).map((item) => ({
        title: (item.title ?? "").replace(/&amp;/g, "&").replace(/&#039;/g, "'").trim(),
        link: item.link ?? "",
        pubDate: item.pubDate ?? item.isoDate ?? "",
        source: feed.source,
        color: feed.color,
        description: (item.contentSnippet ?? item.content ?? "").slice(0, 120).trim(),
      }));
    })
  );

  const items: NewsItem[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") items.push(...r.value);
  }

  return items
    .filter((i) => i.title && i.link)
    .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
    .slice(0, maxItems);
}

export function formatRelativeDate(dateStr: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}
