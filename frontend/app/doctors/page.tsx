import PersonaPage, { PersonaContent } from "../components/persona-page";

const content: PersonaContent = {
  heroHeadline: "Prescribe with confidence.",
  heroSub:
    "Know which drugs are in shortage before you write the script. Avoid the call from a frustrated pharmacist.",
  heroCta: "Start for free",
  heroCtaHref: "/signup",

  problemHeadline: "You prescribed it. It doesn\u2019t exist.",
  problemText:
    "Drug shortages happen downstream. You write the prescription in good faith, the patient takes it to the pharmacy, and it\u2019s not available. Now they\u2019re back in your office, the pharmacist is calling, and you\u2019re rewriting scripts you already wrote. Mederti closes the loop before it opens.",

  features: [
    {
      icon: "\u26A0\uFE0F",
      title: "Shortage alerts before you prescribe",
      desc: "Check any drug\u2019s current supply status in the moment you need it, integrated into your workflow.",
    },
    {
      icon: "\uD83D\uDC8A",
      title: "Therapeutic alternatives",
      desc: "See clinically appropriate substitutes with dosing notes before the pharmacist has to call you.",
    },
    {
      icon: "\uD83C\uDF0D",
      title: "Country-level availability",
      desc: "Know whether a shortage is local or global and advise patients accordingly.",
    },
    {
      icon: "\uD83D\uDCE8",
      title: "Stay ahead of supply chain news",
      desc: "Weekly shortage brief covering the drugs most relevant to your specialty.",
    },
  ],

  previewTitle: "See it in action.",
  previewUrl: "mederti.vercel.app/drugs/amoxicillin",
  previewRows: [
    { label: "Amoxicillin 500mg \u2014 AU", badge: "In shortage", badgeColor: "var(--crit)", badgeBg: "var(--crit-bg)" },
    { label: "Amoxicillin 500mg \u2014 GB", badge: "In shortage", badgeColor: "var(--crit)", badgeBg: "var(--crit-bg)" },
    { label: "Amoxicillin 500mg \u2014 US", badge: "Available", badgeColor: "var(--low)", badgeBg: "var(--low-bg)" },
    { label: "Alternative: Cefalexin 500mg", badge: "Available", badgeColor: "var(--low)", badgeBg: "var(--low-bg)" },
    { label: "Alternative: Augmentin 875/125", badge: "Limited", badgeColor: "var(--med)", badgeBg: "var(--med-bg)" },
  ],

  quote:
    "I used to find out about shortages from my patients. Now I know before they do.",
  quoteName: "Dr. James T.",
  quoteRole: "GP, Sydney",

  ctaHeadline: "Better prescribing starts with better information.",
  ctaButton: "Get started free",
  ctaHref: "/signup",
};

export default function DoctorsPage() {
  return <PersonaPage content={content} />;
}
