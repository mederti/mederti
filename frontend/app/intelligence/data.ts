/* ── Mederti Intelligence — placeholder content ── */

export type Category = "report" | "article" | "data" | "media";

export interface InsightCard {
  slug: string;
  category: Category;
  title: string;
  date: string;
  description: string;
  author?: string;
  duration?: string;
  isPro?: boolean;
  icon?: string;
  readTime?: string;
}

/* ── Category styling ── */
export const CATEGORY_STYLE: Record<Category, { label: string; color: string; bg: string }> = {
  report:  { label: "Report",   color: "var(--indigo)", bg: "var(--ind-bg)" },
  article: { label: "Analysis", color: "var(--teal)",   bg: "var(--teal-bg)" },
  data:    { label: "Data",     color: "var(--low)",    bg: "var(--low-bg)" },
  media:   { label: "Media",    color: "var(--med)",    bg: "var(--med-bg)" },
};

/* ── Shortage Reports ── */
export const REPORTS: InsightCard[] = [
  {
    slug: "global-shortage-report-q1-2026",
    category: "report",
    title: "Global Pharmaceutical Shortage Report \u2014 Q1 2026",
    date: "March 2026",
    description: "Quarterly analysis of shortage trends across 22 countries, covering severity distribution, resolution timelines, and the most-affected therapeutic classes.",
    readTime: "18 min read",
    isPro: true,
  },
  {
    slug: "antibiotic-supply-crisis-12-country",
    category: "report",
    title: "The Antibiotic Supply Crisis: A 12-Country Analysis",
    date: "February 2026",
    description: "Why aminopenicillins are the most at-risk drug class globally, and what the data says about recovery timelines.",
    readTime: "14 min read",
    isPro: true,
  },
  {
    slug: "api-disruption-index-q1-2026",
    category: "report",
    title: "API Manufacturing Disruption Index \u2014 Q1 2026",
    date: "January 2026",
    description: "Tracking upstream manufacturing risk across Indian and Chinese API facilities and their downstream impact on finished-dose availability.",
    readTime: "12 min read",
    isPro: true,
  },
];

/* ── Analysis ── */
export const ARTICLES: InsightCard[] = [
  {
    slug: "why-amoxicillin-keeps-running-out",
    category: "article",
    title: "Why Amoxicillin Keeps Running Out: The API Supply Chain Problem",
    date: "March 2026",
    description: "The structural reasons behind the world\u2019s most common antibiotic shortage, traced from API manufacturing in India to dispensary shelves in Australia.",
    author: "Rob Findlay",
    readTime: "8 min read",
  },
  {
    slug: "hospital-procurement-adapting-chronic-shortages",
    category: "article",
    title: "How Hospital Procurement Teams Are Adapting to Chronic Shortages",
    date: "February 2026",
    description: "Formulary flexibility, safety stock strategies and the rise of real-time monitoring across five major hospital networks.",
    author: "Mederti Data Team",
    readTime: "10 min read",
  },
  {
    slug: "regulatory-divergence-australia-germany",
    category: "article",
    title: "Regulatory Divergence: Why the Same Drug Shorts in Australia but Not Germany",
    date: "January 2026",
    description: "How different regulatory frameworks create asymmetric shortage risk and what it means for cross-border supply strategies.",
    author: "Mederti Data Team",
    readTime: "7 min read",
  },
];

/* ── Data & Signals ── */
export const DATA_RELEASES: InsightCard[] = [
  {
    slug: "singapore-hsa-live",
    category: "data",
    title: "Singapore HSA shortage data now live",
    date: "March 2026",
    description: "198 new shortage records added across Southeast Asia.",
    icon: "\uD83C\uDDF8\uD83C\uDDEC",
  },
  {
    slug: "tga-enhanced-frequency",
    category: "data",
    title: "TGA data refresh upgraded to 3-hourly",
    date: "February 2026",
    description: "Australian shortage data now among the fastest-updating sources globally.",
    icon: "\u26A1",
  },
  {
    slug: "norway-noma-integrated",
    category: "data",
    title: "Norwegian Medicines Agency integrated",
    date: "January 2026",
    description: "Nordic coverage now complete with NoMA shortage declarations tracked and normalised.",
    icon: "\uD83C\uDDF3\uD83C\uDDF4",
  },
];

/* ── Podcasts & Video ── */
export const MEDIA: InsightCard[] = [
  {
    slug: "ep12-global-amoxicillin-crisis",
    category: "media",
    title: "Episode 12: The Global Amoxicillin Crisis Explained",
    date: "March 2026",
    description: "What\u2019s driving the world\u2019s most common antibiotic shortage, with data from 14 regulatory sources.",
    duration: "34 min",
  },
  {
    slug: "video-predictive-risk-score",
    category: "media",
    title: "Video: How Mederti\u2019s Predictive Risk Score Works",
    date: "February 2026",
    description: "A walkthrough of the early warning algorithm that flags drugs before shortages are declared.",
    duration: "8 min",
  },
  {
    slug: "ep11-inside-hospital-procurement",
    category: "media",
    title: "Episode 11: Inside a Hospital Procurement Team During a Critical Shortage",
    date: "January 2026",
    description: "Managing formulary risk in real time at a 600-bed hospital during an injectable antibiotic crisis.",
    duration: "41 min",
  },
];

/* ── Full article body: Why Amoxicillin Keeps Running Out ── */
export const AMOXICILLIN_ARTICLE = {
  slug: "why-amoxicillin-keeps-running-out",
  category: "article" as Category,
  title: "Why Amoxicillin Keeps Running Out: The API Supply Chain Problem",
  author: "Rob Findlay",
  date: "March 2026",
  readTime: "8 min read",
  metaDescription: "An analysis of the global amoxicillin shortage, tracing the root cause to API supply chain concentration in India and China.",
  pullQuote: "The shortage is not a supply problem. It is a structure problem. The same five API facilities serve the entire world, and when one goes down, everyone feels it.",
  sections: [
    {
      body: "Amoxicillin is one of the most widely prescribed antibiotics in the world. It appears on the WHO\u2019s List of Essential Medicines, is used across primary care, paediatrics, and dental practice in virtually every country, and is typically one of the cheapest drugs in any national formulary. Yet for the past three years, it has been in recurrent shortage across Australia, the United Kingdom, Canada, and parts of Europe. The shortages are not isolated incidents \u2014 they follow a pattern that points to structural vulnerability deep in the pharmaceutical supply chain.",
    },
    {
      heading: "The concentration problem",
      body: "The root cause is manufacturing concentration. Over 80% of the world\u2019s amoxicillin active pharmaceutical ingredient (API) is produced by a small number of facilities in India and China. When any one of these facilities experiences a disruption \u2014 whether from regulatory action, raw material scarcity, or seasonal demand surges \u2014 the downstream effect is felt globally within weeks. Finished-dose manufacturers in Europe and Australia, who depend on these API suppliers, have limited ability to switch sources quickly. Qualification of a new API supplier typically takes 12 to 18 months under current regulatory frameworks, meaning that diversification is a multi-year strategic commitment rather than a tactical response.",
    },
    {
      heading: "The winter demand cycle",
      body: "Amoxicillin demand spikes predictably during winter respiratory seasons. In the Southern Hemisphere, this means May through August; in the Northern Hemisphere, November through February. The problem arises when these demand peaks overlap with supply constraints. In 2024 and 2025, winter demand surges in both hemispheres coincided with reduced API output from two major Indian manufacturers undergoing facility upgrades. The result was a shortage that lasted over six months in some markets, with hospitals and pharmacies rationing supply and substituting with broader-spectrum antibiotics \u2014 a practice that carries its own clinical and antimicrobial resistance risks.",
    },
    {
      heading: "Regulatory response timelines",
      body: "Regulatory bodies in affected countries have responded with varying speed and effectiveness. Australia\u2019s TGA issued formal shortage notifications and authorised temporary importation of overseas-registered equivalents. The UK\u2019s MHRA maintained a serious shortage protocol for several months. But these responses are reactive by design \u2014 they are triggered after supply has already failed. The average lag between a manufacturing disruption and a formal shortage declaration is four to six weeks, during which procurement teams are operating blind. This is the window that Mederti\u2019s predictive risk scoring is designed to close.",
    },
    {
      heading: "What procurement teams can do",
      body: "For hospital procurement teams, the practical response is threefold. First, build visibility: track upstream supply signals rather than waiting for official shortage declarations, which often lag reality by weeks. Second, diversify: work with multiple finished-dose suppliers and, where possible, qualify alternative API sources. Third, plan for seasonality: pre-order amoxicillin stock ahead of winter demand peaks using historical consumption data. The amoxicillin story is not unique. It is a template for how modern pharmaceutical supply chains fail: concentrated API manufacturing, long qualification timelines, predictable demand patterns that the system is not structured to absorb. Until the structural incentives change, these shortages will continue to recur. The question for clinicians and procurement teams is not whether they will happen, but whether they will see them coming.",
    },
  ],
};

/* ── Related articles for sidebar ── */
export const RELATED_ARTICLES: InsightCard[] = [
  ARTICLES[1],
  ARTICLES[2],
];
