/**
 * Build a neat, structured PDF of the national Shortage Dashboard (the middle
 * column) — real text + tables, not a screenshot — from the same snapshot the
 * cards render. jsPDF + autotable are loaded dynamically so they stay out of
 * the initial bundle.
 */

import type { DashboardSnapshot } from "./dashboard-snapshot";

// jsPDF's default fonts are WinAnsi — the ▲/▼ triangles fall outside it and
// render as tofu. Em/en dashes are fine, so only the arrows need swapping.
function san(s: string): string {
  return s.replace(/▲\s*/g, "+").replace(/▼\s*/g, "-").replace(/—\s*/g, "").trim();
}

export async function generateDashboardPdf(
  snapshot: DashboardSnapshot,
  summary: string,
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
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...ink);
  doc.text("National Shortage Dashboard", margin, y);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...muted);
  doc.text(`${snapshot.market} · ${snapshot.coverage}`, margin, y);
  y += 13;
  const stamp = new Date().toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
  doc.text(`Window: ${snapshot.rangeLabel}  ·  Generated ${stamp}`, margin, y);
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
  const k = snapshot.kpis;
  sectionTitle("Headline metrics");
  autoTable(doc, {
    ...baseTable,
    startY: y,
    head: [["Metric", "Value", "Change"]],
    body: [
      ["Active shortages", String(k.activeShortages.value), san(k.activeShortages.delta)],
      ["Essential medicines short", `${k.essentialShort.value} of ${k.essentialShort.of}`, san(k.essentialShort.delta)],
      ["Single-source nationally", String(k.singleSource.value), san(k.singleSource.delta)],
      ["Median resolution", `${k.medianResolutionDays.value} days`, san(k.medianResolutionDays.delta)],
      ["Upstream alerts", String(k.upstreamAlerts.value), san(k.upstreamAlerts.delta)],
    ],
  });
  afterTable();

  // ── Essential medicines in shortage ─────────────────────────────────────────
  sectionTitle(`Essential medicines in shortage (${k.essentialShort.value} active)`);
  autoTable(doc, {
    ...baseTable,
    startY: y,
    head: [["Drug", "Class", "Suppliers", "Duration", "Risk", "Forecast"]],
    body: snapshot.topEssential.map((d) => [
      d.drug,
      d.klass,
      d.suppliers,
      `${d.durationDays} days`,
      d.risk,
      d.forecast,
    ]),
  });
  afterTable();

  // ── Concentration risk by class ─────────────────────────────────────────────
  sectionTitle("Concentration risk by class (single-API-source share)");
  autoTable(doc, {
    ...baseTable,
    startY: y,
    head: [["Class", "Single-source share"]],
    body: snapshot.concentration.map((c) => [c.klass, `${c.singleSourcePct}%`]),
  });
  afterTable();

  // ── Shortage burden vs peers ────────────────────────────────────────────────
  sectionTitle("Shortage burden vs peers (per 1,000 listings)");
  autoTable(doc, {
    ...baseTable,
    startY: y,
    head: [["Market", "Active essential shortages / 1,000"]],
    body: snapshot.peers.map((p) => [p.self ? `${p.country} (this market)` : p.country, String(p.shortagesPer1000)]),
  });
  afterTable();

  // ── Upstream early-warning signals ──────────────────────────────────────────
  sectionTitle("Upstream early-warning signals");
  autoTable(doc, {
    ...baseTable,
    columnStyles: { 2: { cellWidth: 230 } },
    startY: y,
    head: [["Site", "Severity", "Signal"]],
    body: snapshot.upstream.map((u) => [`${u.site} (${u.country})`, u.severity, u.note]),
  });
  afterTable();

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

  doc.save(`mederti-shortage-dashboard-${snapshot.range}.pdf`);
}
