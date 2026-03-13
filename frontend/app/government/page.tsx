import PersonaPage, { PersonaContent } from "../components/persona-page";

const content: PersonaContent = {
  heroHeadline: "Know before the calls come in.",
  heroSub:
    "National shortage intelligence for health ministries, regulators, and government procurement agencies.",
  heroCta: "Talk to us",
  heroCtaHref: "/contact",

  problemHeadline: "Reactive is too late.",
  problemText:
    "When a drug shortage becomes a public issue, the calls to your ministry have already started. Clinicians are frustrated, media are asking questions, and you\u2019re working from the same public data everyone else has. Mederti gives government agencies early warning signals, cross-country intelligence, and policy-ready reporting \u2014 before the shortage becomes a crisis.",

  features: [
    {
      icon: "\uD83D\uDDFA\uFE0F",
      title: "National supply dashboard",
      desc: "Market-wide view of active shortages, severity distribution, and resolution timelines across your jurisdiction.",
    },
    {
      icon: "\u2726",
      title: "AI early warning system",
      desc: "Identify medicines at risk of shortage 30\u201390 days before they\u2019re declared, based on global regulatory signals.",
    },
    {
      icon: "\uD83C\uDF10",
      title: "Cross-country intelligence",
      desc: "See how shortages in your country compare to 12 other markets. Understand whether a shortage is local or a global supply chain event.",
    },
    {
      icon: "\uD83D\uDCCB",
      title: "Ministerial briefing generator",
      desc: "One-click exportable briefings formatted for ministerial and executive audiences.",
    },
  ],

  previewTitle: "National supply at a glance.",
  previewUrl: "app.mederti.com/national-dashboard",
  previewRows: [
    { label: "Active critical shortages", badge: "23", badgeColor: "var(--crit)", badgeBg: "var(--crit-bg)" },
    { label: "High severity", badge: "41", badgeColor: "var(--high)", badgeBg: "var(--high-bg)" },
    { label: "New this month", badge: "18", badgeColor: "var(--med)", badgeBg: "var(--med-bg)" },
    { label: "AI early warnings (30\u201360d)", badge: "8", badgeColor: "var(--teal)", badgeBg: "var(--teal-bg)" },
    { label: "Resolved this month", badge: "12", badgeColor: "var(--low)", badgeBg: "var(--low-bg)" },
  ],

  quote:
    "For the first time we have visibility of shortage risk before it becomes a shortage. That changes everything about how we respond.",
  quoteName: "Senior Advisor",
  quoteRole: "Health Ministry",

  ctaHeadline: "Enterprise and government pricing available.",
  ctaButton: "Talk to us",
  ctaHref: "/contact",
};

export default function GovernmentPage() {
  return <PersonaPage content={content} />;
}
