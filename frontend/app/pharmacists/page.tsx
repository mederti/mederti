import type { Metadata } from "next";
import { cookies } from "next/headers";
import PersonaPage, { PersonaContent } from "../components/persona-page";
import { getLivePreviewRows } from "@/lib/persona-preview";

// 10-minute ISR cache. Real shortage data only changes on scraper runs
// (every 4 h+); 10 min staleness is invisible to landing-page visitors
// and the preview-fetch cost (~50 ms) amortises across many cold visits.
export const revalidate = 600;

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
      desc: "Search any drug in seconds. See real-time availability across Australia and other major markets.",
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
  previewUrl: "mederti.com/search",
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

export default async function PharmacistsPage() {
  // Closes audit FINDING-UX-09 — replace hardcoded preview rows with 5
  // real active shortages, filtered to the user's selected country
  // (mederti-country cookie set by landing-nav / HomeNavClient). Falls
  // back to global rows if no cookie; falls back to hardcoded if
  // Supabase is unreachable.
  const country = (await cookies()).get("mederti-country")?.value;
  const liveRows = await getLivePreviewRows({ countryCode: country });
  const resolved: PersonaContent = liveRows
    ? { ...content, previewRows: liveRows }
    : content;
  return <PersonaPage content={resolved} />;
}
