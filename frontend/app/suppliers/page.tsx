import PersonaPage, { PersonaContent } from "../components/persona-page";

const content: PersonaContent = {
  heroHeadline: "Turn shortage intelligence into supply opportunity.",
  heroSub:
    "Mederti gives pharmaceutical suppliers real-time visibility of where demand is unmet, which drugs are at risk, and where you can step in.",
  heroCta: "Get started free",
  heroCtaHref: "/signup",

  problemHeadline: "You\u2019re reacting to a market you could be leading.",
  problemText:
    "By the time a shortage is public knowledge, the opportunity has already moved. Your competitors are already filling the gap. Mederti gives suppliers the same intelligence that hospital procurement teams and regulators use \u2014 so you know where demand is building before it peaks.",

  features: [
    {
      icon: "\uD83D\uDCC9",
      title: "Portfolio risk intelligence",
      desc: "See which drugs in your portfolio are at risk of shortage based on upstream supply signals, regulatory activity, and historical patterns. Know before your customers call.",
    },
    {
      icon: "\uD83D\uDCE1",
      title: "Unmet demand signals",
      desc: "Identify drugs currently in shortage across 22 countries where demand is unmet and supply is needed. See severity, affected countries, and how long the shortage has persisted.",
    },
    {
      icon: "\uD83C\uDF10",
      title: "Global regulatory monitoring",
      desc: "Track shortage declarations across 30+ regulatory bodies in real time. Be the first to know when a new shortage is declared in a market you serve.",
    },
    {
      icon: "\uD83D\uDCCA",
      title: "Market gap analysis",
      desc: "Compare shortage intensity across countries to identify where your existing stock could meet critical unmet need.",
    },
  ],

  previewTitle: "Shortage intelligence, at a glance.",
  previewUrl: "mederti.vercel.app/market-intelligence",
  previewRows: [
    { label: "Amoxicillin 500mg \u00B7 AU, GB, CA", badge: "Critical \u00B7 42 days", badgeColor: "var(--crit)", badgeBg: "var(--crit-bg)" },
    { label: "Cisplatin 1mg/ml \u00B7 US, DE, FR", badge: "Critical \u00B7 28 days", badgeColor: "var(--crit)", badgeBg: "var(--crit-bg)" },
    { label: "Metformin 850mg \u00B7 NZ, SG", badge: "High \u00B7 19 days", badgeColor: "var(--high)", badgeBg: "var(--high-bg)" },
    { label: "Salbutamol 100mcg \u00B7 GB, IE", badge: "High \u00B7 14 days", badgeColor: "var(--high)", badgeBg: "var(--high-bg)" },
    { label: "Atorvastatin 40mg \u00B7 CA", badge: "Elevated \u00B7 7 days", badgeColor: "var(--med)", badgeBg: "var(--med-bg)" },
  ],

  quote:
    "We identified three shortage opportunities in the first week. Mederti has become a core part of our commercial intelligence process.",
  quoteName: "Commercial Director",
  quoteRole: "Pharmaceutical Distributor",

  ctaHeadline: "The shortage market moves fast. Be ahead of it.",
  ctaButton: "Get started free",
  ctaHref: "/signup",
};

export default function SuppliersPage() {
  return <PersonaPage content={content} />;
}
