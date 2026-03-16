import type { Metadata } from "next";
import PersonaPage, { PersonaContent } from "../components/persona-page";

export const metadata: Metadata = {
  title: "Mederti for Pharmacists — Drug shortage answers at the dispensary counter",
  description:
    "Real-time drug shortage intelligence built for pharmacists. Instant answers on stock availability, trusted alternatives, and restocking timelines.",
  openGraph: {
    title: "Mederti for Pharmacists — Drug shortage answers at the dispensary counter",
    description:
      "Real-time drug shortage intelligence built for pharmacists. Instant answers on stock availability, trusted alternatives, and restocking timelines.",
  },
};

const content: PersonaContent = {
  heroHeadline: "Know before your patient asks.",
  heroSub:
    "Real-time drug shortage intelligence built for the dispensary counter. Instant answers, trusted alternatives, zero guesswork.",
  heroCta: "Start for free",
  heroCtaHref: "/signup",

  problemHeadline: "The moment every pharmacist dreads",
  problemText:
    "A patient hands you a prescription. The drug isn\u2019t in stock. You check your supplier portal \u2014 nothing. You call around \u2014 nothing. Meanwhile they\u2019re waiting. Mederti tells you instantly: what\u2019s in shortage, what you can use instead, and when stock is back.",

  features: [
    {
      icon: "\uD83D\uDD0D",
      title: "Instant shortage lookup",
      desc: "Search any drug in seconds. See real-time availability across Australia and 12 other countries.",
    },
    {
      icon: "\uD83E\uDDE0",
      title: "AI-matched alternatives",
      desc: "Get therapeutically appropriate substitutes ranked by similarity and current availability.",
    },
    {
      icon: "\uD83D\uDD14",
      title: "Alert when it\u2019s back",
      desc: "Set a one-tap alert and get notified the moment stock returns in your country.",
    },
    {
      icon: "\uD83D\uDCF1",
      title: "Mobile-optimised",
      desc: "Designed for the dispensary counter, not a desktop. Fast, clear, no clutter.",
    },
  ],

  previewTitle: "See it in action.",
  previewUrl: "mederti.vercel.app/search",
  previewRows: [
    { label: "Amoxicillin 500mg", badge: "Critical", badgeColor: "var(--crit)", badgeBg: "var(--crit-bg)" },
    { label: "Paracetamol IV 10mg/ml", badge: "Critical", badgeColor: "var(--crit)", badgeBg: "var(--crit-bg)" },
    { label: "Metformin 850mg", badge: "High", badgeColor: "var(--high)", badgeBg: "var(--high-bg)" },
    { label: "Atorvastatin 40mg", badge: "Medium", badgeColor: "var(--med)", badgeBg: "var(--med-bg)" },
    { label: "Sertraline 50mg", badge: "Resolved", badgeColor: "var(--low)", badgeBg: "var(--low-bg)" },
  ],

  quote:
    "Mederti has completely changed how I handle shortage conversations with patients. I have an answer in seconds.",
  quoteName: "Sarah K.",
  quoteRole: "Community Pharmacist, Melbourne",

  ctaHeadline: "Free for individual pharmacists. Always.",
  ctaButton: "Get started free",
  ctaHref: "/signup",
};

export default function PharmacistsPage() {
  return <PersonaPage content={content} />;
}
