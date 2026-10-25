/**
 * Build a neat, structured PDF of the national Shortage Dashboard (the middle
 * column) — real text + tables, not a screenshot — from the same live data the
 * cards render (lib/insights/dashboard-data.ts). jsPDF + autotable are loaded dynamically so they stay out of
 * the initial bundle.
 */

import type { DashboardData } from "./dashboard-data-shared";
import { COUNTRY_NAMES, TIER_LABEL } from "./dashboard-data-shared";

function supplyFacts(e: { nApiMakers: number | null; nFinishedFirms: number | null }): string {
  return [
    e.nApiMakers != null ? `${e.nApiMakers} API makers` : null,
    e.nFinishedFirms != null ? `${e.nFinishedFirms} US finished-dose firms` : null,
  ].filter(Boolean).join(", ");
}

export async function generateDashboardPdf(
  data: DashboardData,
  summary: string | null,
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - margin * 2;
  let y = margin;

  const ink: [number, number, number] = [12, 17, 24];
  const muted: [number, number, number] = [120, 128, 136];
  const teal: [number, number, number] = [12, 138, 98];
  const headFill: [number, number, number] = [238, 242, 245];

  const ensure = (need: number) => {
    if (y + need > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const sectionTitle = (label: string) => {
    ensure(28);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...ink);
    doc.text(label, margin, y);
    y += 12;
  };

  const afterTable = () => {
    // jspdf-autotable records the last table's geometry on the doc.
    y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? y) + 22;
  };

  const baseTable = {
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 5, textColor: [40, 46, 54] as [number, number, number], lineColor: [228, 232, 236] as [number, number, number], lineWidth: 0.5 },
    headStyles: { fillColor: headFill, textColor: ink, fontStyle: "bold" as const, fontSize: 8 },
    theme: "grid" as const,
  };

  // ── Header ────────────────────────────────────────────────────────────────
  const market = COUNTRY_NAMES[data.country] ?? data.country;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...ink);
  doc.text("National Shortage Dashboard", margin, y);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...muted);
  doc.text(`${market} · live data from regulator shortage reports`, margin, y);
  y += 13;
  const stamp = new Date(data.generatedAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
  doc.text(`Generated ${stamp}`, margin, y);
  y += 10;
  doc.setDrawColor(225);
  doc.line(margin, y, pageW - margin, y);
  y += 20;

  // ── AI market read ──────────────────────────────────────────────────────────
  if (summary) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...teal);
    doc.text("AI MARKET READ", margin, y);
    y += 13;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(60, 66, 74);
    for (const line of doc.splitTextToSize(summary, contentW) as string[]) {
      ensure(14);
      doc.text(line, margin, y);
      y += 13;
    }
    y += 12;
  }

  // ── Headline KPIs ───────────────────────────────────────────────────────────
  const k = data.kpis;
  sectionTitle("Headline metrics");
  autoTable(doc, {
    ...baseTable,
    startY: y,
    head: [["Metric", "Value"]],
    body: [
      ["Active shortage reports", `${k.activeReports} (${k.newLast30} new in 30 days)`],
      ["Essential or critical medicines short", `${k.essentialShort} of ${data.universeSize}`],
      ["...with concentrated API supply", String(k.essentialShortConcentrated)],
      ["Median resolution, last 12 months", k.medianResolutionDays == null ? "n/a" : `${k.medianResolutionDays} days (${k.resolvedLast12mo} resolved)`],
      ["Short in 2+ peer markets, not reported here", String(k.earlyWarning)],
    ],
  });
  afterTable();

  // ── Essential medicines in shortage ─────────────────────────────────────────
  sectionTitle(`Essential medicines short in ${market} (${k.essentialShort})`);
  autoTable(doc, {
    ...baseTable,
    startY: y,
    head: [["Medicine", "Lists", "Days since first report", "Supply base", "Countries short"]],
    body: data.essential.map((e) => [
      e.name,
      [e.whoList ? `WHO ${e.whoList}` : null, e.euCritical ? "EU critical" : null].filter(Boolean).join(", "),
      e.daysShort == null ? "n/a" : String(e.daysShort),
      e.tier === "unknown" ? "Unknown" : `${TIER_LABEL[e.tier]} (${supplyFacts(e)})`,
      String(e.countriesShort),
    ]),
  });
  afterTable();

  // ── Early warning ───────────────────────────────────────────────────────────
  sectionTitle("Short in 2+ peer markets, not reported here");
  autoTable(doc, {
    ...baseTable,
    startY: y,
    head: [["Medicine", "Peer markets short", "API supply"]],
    body: data.earlyWarning.slice(0, 30).map((e) => [e.name, e.peers.join(", "), TIER_LABEL[e.tier]]),
  });
  afterTable();

  // ── Peers ───────────────────────────────────────────────────────────────────
  sectionTitle("Essential medicines short, by peer market");
  autoTable(doc, {
    ...baseTable,
    startY: y,
    head: [["Market", "Essential medicines short"]],
    body: data.peers.map((p) => [p.self ? `${p.country} (this market)` : p.country, String(p.essentialShort)]),
  });
  afterTable();

  // ── Method note ─────────────────────────────────────────────────────────────
  ensure(40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...muted);
  for (const line of doc.splitTextToSize(
    "Essential = on the WHO Model List of Essential Medicines or the EU Union list of critical medicines. " +
    "API supply concentration counts distinct API manufacturers in FDA Drug Master File and WHO prequalification data (US-centric). " +
    "Concentration describes the supply base; Mederti's backtest found it does not predict when a shortage starts or how long it lasts.",
    contentW,
  ) as string[]) {
    doc.text(line, margin, y);
    y += 11;
  }

  // ── Footer on every page ────────────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text("Mederti · short-supply medicines intelligence · not medical advice", margin, pageH - 22);
    doc.text(`${i} / ${pages}`, pageW - margin, pageH - 22, { align: "right" });
  }

  doc.save(`mederti-shortage-dashboard-${data.country}-${data.generatedAt.slice(0, 10)}.pdf`);
}
