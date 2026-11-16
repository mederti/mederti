import type { Metadata } from "next";
import AppShell from "@/app/components/v1/AppShell";
import { countriesOverview } from "@/lib/countries-overview";
import CountriesMap from "./CountriesMap";

// Countries map: a world choropleth of open shortage notices per country, with
// hover figures and click-through to each country page. Sits under Dashboard
// in the sidebar. Figures come from lib/countries-overview.ts and match the
// country pages exactly.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Countries — shortage map | Mederti",
  description:
    "World map of open medicine shortage notices by country, from each country's official regulator.",
};

const n = (v: number | null) => (v === null ? "unavailable" : String(v));

export default async function CountriesPage() {
  const { rows, generatedAt } = await countriesOverview();

  const bodyText = [
    "The user is viewing a world map coloured by the number of open (active) medicine shortage notices in each country Mederti collects from, plus a table of the same figures.",
    "Counts are NOTICES, not medicines: regulators list each strength/pack separately and apply different reporting rules, so totals are not directly comparable between countries. Say so when asked to compare or rank countries.",
    "Countries not listed have no public shortage source in Mederti — that is not evidence of no shortages. A listed country with 0 open notices means Mederti holds no open notice from that source, not that supply is confirmed normal.",
    `Figures as of ${generatedAt}. Country | sources | active notices | critical | anticipated:`,
    ...rows.map(
      (r) => `- ${r.name} (${r.code}) | ${r.regulators.join(", ") || "unknown"} | ${n(r.active)} | ${n(r.critical)} | ${n(r.anticipated)}`,
    ),
  ].join("\n");

  return (
    <AppShell
      contentClassName="wide"
      chat={{
        contextKey: "countries-map",
        title: "Shortages by country",
        category: "Countries",
        bodyText,
        headerLabel: "Ask about countries",
        emptyLead: "Ask me about the countries on this map.",
        starters: [
          "Which countries have the most critical notices?",
          "Why can't notice counts be compared between countries?",
          "Which countries does Mederti not cover?",
        ],
      }}
    >
      <CountriesMap rows={rows} generatedAt={generatedAt} />
    </AppShell>
  );
}
