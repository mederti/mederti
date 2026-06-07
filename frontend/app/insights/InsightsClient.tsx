"use client";

// Standalone public "insights" reading layout: the same 3-column shell as the
// /chat reading view (sidebar · operational view · grounded chat), but on its
// own route so the two dashboards can be public in the soft-launch tier WITHOUT
// exposing the full /chat product. Reuses the exact view components + the
// generalized ContextChat so there's a single source of truth for both.
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { DesktopOnly } from "@/app/components/DesktopOnly";
import V1CountryPicker from "@/app/components/v1/V1CountryPicker";
import { EarlyWarningView } from "@/app/chat/components/views/EarlyWarningView";
import { GovDashboardView } from "@/app/chat/components/views/GovDashboardView";
import { ContextChat } from "@/app/chat/components/ContextChat";
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
    category: "Predictive early-warning radar (global)",
    headerLabel: "Ask about the radar",
    bodyText:
      "Mederti predictive early-warning radar (global). Forecasts which drugs are likely to go into shortage BEFORE official declaration, using upstream signals from 22 countries (e.g. India CDSCO GMP flags, China NMPA precursor export drops, environmental closures, recurring seasonal patterns, sponsor deregistrations). Drugs are ranked by probability × clinical impact, each with a signal driver, a predicted window, a probability, and a confidence score. Also surfaces a live upstream-site feed and the model's forecast-confidence / calibration.",
    starters: [
      "Why is cephalexin flagged as high-risk?",
      "What upstream signals feed amoxicillin supply?",
      "How accurate are these forecasts historically?",
    ],
  },
  dashboard: {
    Component: GovDashboardView,
    title: "National Shortage Dashboard",
    category: "National medicines-supply dashboard (Australia)",
    headerLabel: "Ask about this dashboard",
    bodyText:
      "Mederti National Shortage Dashboard for Australia — the national medicines-supply picture across the TGA plus benchmarked regulators. Headline metrics: active shortages, essential medicines in shortage (WHO EML affected), medicines single-sourced nationally, median resolution time vs peers, and upstream alerts (India/China API sites). It lists the essential medicines currently in shortage (drug, class/ATC, suppliers active, duration, clinical risk, forecast return window), shows concentration risk by drug class (share dependent on a single API source), and benchmarks Australia's essential-medicine shortage burden against peer countries.",
    starters: [
      "Which essential medicines are at critical risk right now?",
      "How does Australia's shortage burden compare to peer countries?",
      "What's driving the beta-lactam antibiotic concentration risk?",
    ],
  },
};

function NavItem({ kind, active, children }: { kind: InsightKind; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={`/insights/${kind}`}
      className={`flex items-center gap-2.5 text-[13.5px] px-2 py-2 rounded-md transition-colors ${
        active ? "font-semibold" : "text-slate-600 hover:bg-slate-100"
      }`}
      style={active ? { background: "var(--teal-bg)", color: "var(--teal-l)" } : undefined}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--teal)" }} />
      {children}
    </Link>
  );
}

export default function InsightsClient({ kind }: { kind: InsightKind }) {
  const cfg = CONFIG[kind];
  const ViewComp = cfg.Component;

  return (
    <DesktopOnly>
      <div
        className="mederti-chat-root flex h-screen overflow-hidden bg-white text-slate-900"
        style={{ fontFamily: "var(--font-inter), Inter, system-ui, sans-serif" }}
      >
        {/* ── Left sidebar ── */}
        <aside className="w-[236px] shrink-0 border-r border-slate-200 flex flex-col bg-white">
          <div className="px-4 pt-4 pb-2.5">
            <Link href="/" className="inline-flex items-center" aria-label="Mederti home">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-black.png" alt="mederti" className="h-6 w-auto" />
            </Link>
          </div>
          <div className="px-3.5 pb-2">
            <V1CountryPicker />
          </div>
          <div className="flex-1 overflow-y-auto px-2.5 pb-2.5">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 px-2 pt-2 pb-2">
              Browse
            </div>
            <Link
              href="/search"
              className="flex items-center gap-2.5 text-[13.5px] px-2 py-2 rounded-md text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--teal)" }} />
              Search
            </Link>
            <NavItem kind="intelligence" active={kind === "intelligence"}>
              Intelligence
            </NavItem>
            <NavItem kind="dashboard" active={kind === "dashboard"}>
              Dashboard
            </NavItem>
          </div>
          <Link href="/login" className="px-4 py-3.5 border-t border-slate-200 text-[13px] text-slate-600 hover:text-slate-900">
            Log in →
          </Link>
        </aside>

        {/* ── Center: the operational view ── */}
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

        {/* ── Right: grounded chat ── */}
        <ContextChat
          key={`insight:${kind}`}
          contextKey={kind}
          title={cfg.title}
          category={cfg.category}
          bodyText={cfg.bodyText}
          headerLabel={cfg.headerLabel}
          emptyLead={
            <>
              You&apos;re viewing{" "}
              <span className="font-medium text-slate-700">{cfg.title}</span>. Ask me anything
              about it — I&apos;ll use live Mederti data for specifics.
            </>
          }
          starters={cfg.starters}
        />
      </div>
    </DesktopOnly>
  );
}
