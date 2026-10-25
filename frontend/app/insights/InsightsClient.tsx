"use client";

// Standalone public "insights" reading layout: the same 3-column shell as the
// /chat reading view (sidebar · operational view · grounded chat), but on its
// own route so the two dashboards can be public in the soft-launch tier WITHOUT
// exposing the full /chat product. Reuses the exact view components + the
// generalized ContextChat so there's a single source of truth for both.
import { COVERAGE_COPY } from "@/lib/coverage-copy";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { DesktopOnly } from "@/app/components/DesktopOnly";
import V1Sidebar from "@/app/components/v1/V1Sidebar";
import { EarlyWarningView } from "@/app/chat/components/views/EarlyWarningView";
import { GovDashboardView } from "@/app/chat/components/views/GovDashboardView";
import { ContextChat } from "@/app/chat/components/ContextChat";
import MobileTabBar from "@/app/components/v1/MobileTabBar";
// Scoped chat.css powers ContextChat's rich answer rendering under
// .mederti-chat-root (same wrapper /chat uses).
import "@/app/chat/chat.css";

export type InsightKind = "intelligence" | "dashboard";

// Single source of truth for what each public view is + how the side chat
// grounds on it. bodyText mirrors /chat's VIEW_CONFIG so answers are identical
// across both surfaces.
const CONFIG: Record<
  InsightKind,
  {
    Component: React.ComponentType;
    title: string;
    category: string;
    headerLabel: string;
    bodyText: string;
    starters: string[];
  }
> = {
  intelligence: {
    Component: EarlyWarningView,
    title: "Early-warning radar",
    category: "Early-warning radar (peer markets)",
    headerLabel: "Ask about the radar",
    bodyText:
      "Mederti early-warning radar. Lists drugs in active shortage in two or more of the user's peer markets but not yet reported short in the user's market, from official regulator shortage reports (" + COVERAGE_COPY.countries + "). Each row shows the peer markets short, the worst severity and how long the peers have been short. It is an observation, not a forecast: in Mederti's 2025–26 history such drugs were 2.5–6× more likely to be reported short in the user's market within six months (13–39% vs 3–11%), but most were not. There are no probabilities, predicted windows, confidence scores or upstream site feeds on this page.",
    starters: [
      "Which of these are WHO essential medicines?",
      "Which peer markets are short on the top flagged drug?",
      "How often do these flags turn into local shortages?",
    ],
  },
  dashboard: {
    Component: GovDashboardView,
    title: "National Shortage Dashboard",
    category: "National medicines-supply dashboard",
    headerLabel: "Ask about this dashboard",
    bodyText:
      "Mederti National Shortage Dashboard for the user's market (from the sidebar country picker), built live from regulator shortage reports. Headline metrics: active shortage reports and how many started in the last 30 days; essential medicines (WHO Model List or EU Union list of critical medicines) short now, and how many of those have concentrated supply; median duration of shortages resolved in the last 12 months; and essential medicines short in two or more peer markets but not reported here. It lists the essential medicines short now (days since first report, number of API makers and US finished-dose firms, top API-making country, countries short), plots supply concentration against how many countries are short, compares essential shortages across peer markets, and shows where essential-medicine APIs are made. Supply concentration describes the supply base; Mederti's backtest found it predicts neither when a shortage starts nor how long it lasts. There are no forecasts, clinical-risk scores or upstream site alerts on this page.",
    starters: [
      "Which essential medicines are at critical risk right now?",
      "How does Australia's shortage burden compare to peer countries?",
      "What's driving the beta-lactam antibiotic concentration risk?",
    ],
  },
};

export default function InsightsClient({ kind }: { kind: InsightKind }) {
  const cfg = CONFIG[kind];
  const ViewComp = cfg.Component;

  return (
    <DesktopOnly>
      <div
        className="mederti-chat-root flex h-screen overflow-hidden bg-white text-slate-900"
        style={{ fontFamily: "var(--font-inter), Inter, system-ui, sans-serif" }}
      >
        {/* ── Left sidebar (shared app shell, identical to /chat, /search, /drugs) ── */}
        <V1Sidebar />

        {/* ── Middle: grounded chat (new template — chat drives, reading
             left-to-right as nav → conversation → detail) ── */}
        <ContextChat
          key={`insight:${kind}`}
          contextKey={kind}
          title={cfg.title}
          category={cfg.category}
          bodyText={cfg.bodyText}
          headerLabel={cfg.headerLabel}
          placement="left"
          emptyLead={
            <>
              You&apos;re viewing{" "}
              <span className="font-medium text-slate-700">{cfg.title}</span>. Ask me anything
              about it — I&apos;ll use live Mederti data for specifics.
            </>
          }
          starters={cfg.starters}
        />

        {/* ── Right: the operational view, full-width detail panel ── */}
        <main className="flex-1 min-w-0 flex flex-col h-screen bg-white">
          <div className="h-14 flex items-center px-6 gap-3 shrink-0 border-b border-slate-100">
            <Link
              href="/search"
              className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-900 px-2 py-1.5 rounded-md hover:bg-slate-100 transition-colors"
            >
              <ChevronLeft size={14} />
              Back
            </Link>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 mx-1">
              Live view
            </span>
          </div>
          <div className="flex-1 min-h-0">
            <ViewComp />
          </div>
        </main>

        <MobileTabBar />
      </div>
    </DesktopOnly>
  );
}
