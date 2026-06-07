import { notFound } from "next/navigation";
import type { Metadata } from "next";
import InsightsClient, { type InsightKind } from "../InsightsClient";

export const dynamic = "force-dynamic";

const KINDS: InsightKind[] = ["intelligence", "dashboard"];

const META: Record<InsightKind, { title: string; description: string }> = {
  intelligence: {
    title: "Intelligence — Early-warning radar | Mederti",
    description:
      "Predictive early-warning radar: drugs forecast to go into shortage before official declaration, with a grounded chat to ask questions of the data.",
  },
  dashboard: {
    title: "National Shortage Dashboard | Mederti",
    description:
      "National medicines-supply dashboard across the TGA and benchmarked regulators, with a grounded chat to ask questions of the data.",
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ kind: string }>;
}): Promise<Metadata> {
  const { kind } = await params;
  const m = META[kind as InsightKind];
  return m ? { title: m.title, description: m.description } : {};
}

export default async function InsightsPage({
  params,
}: {
  params: Promise<{ kind: string }>;
}) {
  const { kind } = await params;
  if (!KINDS.includes(kind as InsightKind)) notFound();
  return <InsightsClient kind={kind as InsightKind} />;
}
