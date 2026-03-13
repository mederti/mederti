import PersonaPage, { PersonaContent } from "../components/persona-page";

const content: PersonaContent = {
  heroHeadline: "Stop managing shortages. Start anticipating them.",
  heroSub:
    "Proactive shortage intelligence for procurement teams. Know weeks ahead, not days after.",
  heroCta: "Book a demo",
  heroCtaHref: "/contact",

  problemHeadline: "Shortages don\u2019t announce themselves.",
  problemText:
    "By the time a shortage reaches your procurement team, you\u2019re already in emergency mode \u2014 substituting drugs mid-treatment, managing clinical risk, and explaining to clinicians why the formulary changed overnight. Mederti gives you the lead time to act before the crisis hits.",

  features: [
    {
      icon: "\uD83D\uDCC1",
      title: "Bulk formulary upload",
      desc: "Upload your entire formulary as a CSV or Excel file and get an instant shortage risk report across every drug.",
    },
    {
      icon: "\uD83D\uDCC8",
      title: "Predictive risk scores",
      desc: "AI-powered risk scores flag drugs likely to enter shortage in the next 30\u201390 days based on regulatory patterns.",
    },
    {
      icon: "\uD83D\uDD14",
      title: "Watchlist alerts",
      desc: "Monitor your critical medicines 24/7. Get notified the moment status changes, by email or SMS.",
    },
    {
      icon: "\uD83D\uDCC4",
      title: "Exportable PDF reports",
      desc: "One-click shortage reports formatted for procurement committees and clinical governance meetings.",
    },
  ],

  previewTitle: "Your formulary, scored in seconds.",
  previewUrl: "app.mederti.com/dashboard",
  previewRows: [
    { label: "Cisplatin 1mg/ml", badge: "Critical \u00B7 Score 82", badgeColor: "var(--crit)", badgeBg: "var(--crit-bg)" },
    { label: "Amoxicillin 500mg", badge: "Critical \u00B7 Score 78", badgeColor: "var(--crit)", badgeBg: "var(--crit-bg)" },
    { label: "Ciprofloxacin 500mg", badge: "High risk \u00B7 Score 65", badgeColor: "var(--high)", badgeBg: "var(--high-bg)" },
    { label: "Metformin 500mg", badge: "Elevated \u00B7 Score 48", badgeColor: "var(--med)", badgeBg: "var(--med-bg)" },
    { label: "Atorvastatin 40mg", badge: "Watch \u00B7 Score 31", badgeColor: "var(--low)", badgeBg: "var(--low-bg)" },
  ],

  quote:
    "We uploaded our formulary and had a full shortage risk assessment in under two minutes. That used to take our team a week.",
  quoteName: "Head of Pharmacy",
  quoteRole: "Major Metropolitan Hospital",

  ctaHeadline: "Built for procurement teams who can\u2019t afford surprises.",
  ctaButton: "Book a demo",
  ctaHref: "/contact",
};

export default function HospitalsPage() {
  return <PersonaPage content={content} />;
}
