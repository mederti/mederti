"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  FileSpreadsheet, Download, ExternalLink, AlertTriangle,
  CheckCircle2, Loader2, X, ArrowLeft, FileDown,
} from "lucide-react";
import { downloadSampleCSV } from "./bulk-upload-sample";

/* ── Types ── */

interface ParsedRow {
  rowIndex: number;
  drugName: string;          // sent to API for matching
  drugDescription: string;   // raw cell value for display
  quantity?: number;          // qty ordered
  backorderQty?: number;     // qty backordered
  supplier?: string;         // vendor/supplier
}

interface ShortageInfo {
  shortage_id: string;
  drug_id: string;
  country_code: string | null;
  status: string;
  severity: string | null;
  start_date: string | null;
}

interface LookupResult {
  drugName: string;
  matchedDrug: {
    drug_id: string;
    generic_name: string;
    brand_names: string[];
    atc_code: string | null;
  } | null;
  matchConfidence: "exact" | "fuzzy" | "none";
  shortages: ShortageInfo[];
}

interface ResultRow extends ParsedRow {
  lookup: LookupResult;
  worstSeverity: string;
  sortRank: number;
  hasBackorder: boolean;
}

interface ColumnMap {
  drugCol: string | null;
  qtyOrderedCol: string | null;
  qtyBackorderedCol: string | null;
  supplierCol: string | null;
  method: "ai" | "fallback";
}

type Phase = "parsing" | "detecting-columns" | "looking-up" | "done" | "error";

/* ── Constants ── */

const FLAGS: Record<string, string> = {
  AU: "\u{1F1E6}\u{1F1FA}", US: "\u{1F1FA}\u{1F1F8}", GB: "\u{1F1EC}\u{1F1E7}", CA: "\u{1F1E8}\u{1F1E6}", DE: "\u{1F1E9}\u{1F1EA}",
  FR: "\u{1F1EB}\u{1F1F7}", IT: "\u{1F1EE}\u{1F1F9}", ES: "\u{1F1EA}\u{1F1F8}", NZ: "\u{1F1F3}\u{1F1FF}", SG: "\u{1F1F8}\u{1F1EC}",
  EU: "\u{1F1EA}\u{1F1FA}", IE: "\u{1F1EE}\u{1F1EA}", NL: "\u{1F1F3}\u{1F1F1}", CH: "\u{1F1E8}\u{1F1ED}", NO: "\u{1F1F3}\u{1F1F4}",
  FI: "\u{1F1EB}\u{1F1EE}", SE: "\u{1F1F8}\u{1F1EA}", DK: "\u{1F1E9}\u{1F1F0}", AT: "\u{1F1E6}\u{1F1F9}", BE: "\u{1F1E7}\u{1F1EA}",
  CZ: "\u{1F1E8}\u{1F1FF}", HU: "\u{1F1ED}\u{1F1FA}", JP: "\u{1F1EF}\u{1F1F5}", IN: "\u{1F1EE}\u{1F1F3}", BR: "\u{1F1E7}\u{1F1F7}",
  ZA: "\u{1F1FF}\u{1F1E6}", PL: "\u{1F1F5}\u{1F1F1}", PT: "\u{1F1F5}\u{1F1F9}", GR: "\u{1F1EC}\u{1F1F7}", MX: "\u{1F1F2}\u{1F1FD}",
};

const SEV: Record<string, { color: string; bg: string; border: string; label: string; rank: number }> = {
  critical: { color: "#dc2626", bg: "#fef2f2", border: "#fecaca", label: "Critical", rank: 0 },
  high:     { color: "#ea580c", bg: "#fff7ed", border: "#fed7aa", label: "High",     rank: 1 },
  medium:   { color: "#ca8a04", bg: "#fefce8", border: "#fef08a", label: "Medium",   rank: 2 },
  low:      { color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", label: "Low",      rank: 3 },
  active:   { color: "#ea580c", bg: "#fff7ed", border: "#fed7aa", label: "Active",   rank: 1 },
  anticipated: { color: "#ca8a04", bg: "#fefce8", border: "#fef08a", label: "Anticipated", rank: 2 },
  ok:       { color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", label: "OK",       rank: 5 },
  none:     { color: "#94a3b8", bg: "#f8fafc", border: "#e2e8f0", label: "Not in database", rank: 6 },
};

const SKIP_PATTERNS = /^(total|subtotal|grand total|page total|sum|report total)$/i;

/* ── Helpers ── */

function worstSev(shortages: ShortageInfo[]): string {
  if (shortages.length === 0) return "ok";
  const ranks = shortages.map((s) => SEV[s.severity ?? "medium"]?.rank ?? 3);
  const best = Math.min(...ranks);
  const entry = Object.entries(SEV).find(([, v]) => v.rank === best);
  return entry ? entry[0] : "medium";
}

function sortRank(result: LookupResult, hasBackorder: boolean): number {
  if (!result.matchedDrug) return 100;
  if (result.shortages.length === 0 && !hasBackorder) return 50;
  if (result.shortages.length === 0 && hasBackorder) return 40;
  const sevRank = Math.min(...result.shortages.map((s) => SEV[s.severity ?? "medium"]?.rank ?? 3));
  return hasBackorder ? Math.max(sevRank - 1, 0) : sevRank;
}

function mapRowsFromColumns(
  data: Record<string, string>[],
  colMap: ColumnMap,
): ParsedRow[] {
  const { drugCol, qtyOrderedCol, qtyBackorderedCol, supplierCol } = colMap;
  if (!drugCol) throw new Error("Could not detect a drug name column. Expected a column like \"Description\", \"Drug Name\", or \"Product\".");

  return data
    .map((row, i) => {
      const rawDrug = (row[drugCol] ?? "").trim();
      return {
        rowIndex: i + 1,
        drugName: rawDrug,
        drugDescription: rawDrug,
        quantity: qtyOrderedCol ? parseFloat(row[qtyOrderedCol]) || undefined : undefined,
        backorderQty: qtyBackorderedCol ? parseFloat(row[qtyBackorderedCol]) || undefined : undefined,
        supplier: supplierCol ? (row[supplierCol] ?? "").trim() || undefined : undefined,
      };
    })
    .filter((r) => r.drugName.length > 0 && !SKIP_PATTERNS.test(r.drugName));
}

/* ── Component ── */

interface BulkUploadProps {
  file: File;
  onClose: () => void;
}

export default function BulkUpload({ file, onClose }: BulkUploadProps) {
  const [phase, setPhase] = useState<Phase>("parsing");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [totalParsed, setTotalParsed] = useState(0);
  const [truncated, setTruncated] = useState(false);

  const processFile = useCallback(async () => {
    try {
      /* ── Phase 1: Parse file ── */
      setPhase("parsing");
      setProgress("Reading file\u2026");

      let rawData: Record<string, string>[];
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

      if (ext === "csv" || ext === "tsv") {
        const Papa = (await import("papaparse")).default;
        rawData = await new Promise((resolve, reject) => {
          Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => resolve(results.data as Record<string, string>[]),
            error: reject,
          });
        });
      } else if (ext === "xlsx" || ext === "xls") {
        const XLSX = await import("xlsx");
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rawData = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" });
      } else {
        throw new Error(`Unsupported file type: .${ext}. Please upload a CSV or Excel file.`);
      }

      /* ── Title row detection ── */
      let headers = Object.keys(rawData[0] ?? {});
      let actualData = rawData;

      if (rawData.length > 1) {
        const firstRowValues = Object.values(rawData[0] ?? {});
        const populatedCells = firstRowValues.filter((v) => v && String(v).trim().length > 0).length;

        if (populatedCells < 4) {
          const newHeaders = Object.values(rawData[0]).map((v) => String(v).trim()).filter(Boolean);
          if (newHeaders.length >= 3) {
            actualData = rawData.slice(1).map((row) => {
              const mapped: Record<string, string> = {};
              const vals = Object.values(row);
              newHeaders.forEach((h, i) => { mapped[h] = vals[i] ?? ""; });
              return mapped;
            });
            headers = newHeaders;
          }
        }
      }

      setTotalParsed(actualData.length);

      // 500-row limit
      let wasTruncated = false;
      if (actualData.length > 500) {
        actualData = actualData.slice(0, 500);
        wasTruncated = true;
        setTruncated(true);
      }

      setProgress(`Parsed ${actualData.length} rows${wasTruncated ? " (limited to 500)" : ""}`);

      /* ── Phase 2: Detect columns ── */
      setPhase("detecting-columns");
      setProgress("Analyzing column layout\u2026");

      const sampleRows = actualData.slice(0, 2).map((row) =>
        headers.map((h) => row[h] ?? "")
      );

      let colMap: ColumnMap;
      try {
        const detectRes = await fetch("/api/detect-columns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ headers, sampleRows }),
        });
        if (!detectRes.ok) throw new Error(`${detectRes.status}`);
        colMap = await detectRes.json();
      } catch {
        throw new Error("Failed to analyze file columns. Please try again.");
      }

      if (!colMap.drugCol) {
        throw new Error(
          "Could not identify a drug name column. Expected a column like \"Description\", \"Drug Name\", or \"Product\"."
        );
      }

      setProgress(
        colMap.method === "ai"
          ? `AI detected columns: ${colMap.drugCol}${colMap.supplierCol ? `, ${colMap.supplierCol}` : ""}`
          : `Detected columns: ${colMap.drugCol}${colMap.supplierCol ? `, ${colMap.supplierCol}` : ""}`
      );

      /* ── Phase 3: Map rows ── */
      const parsed = mapRowsFromColumns(actualData, colMap);
      if (parsed.length === 0) {
        throw new Error("No valid drug names found in the file after filtering.");
      }

      /* ── Phase 4: Lookup ── */
      setPhase("looking-up");
      const uniqueNames = [...new Set(parsed.map((r) => r.drugName))];
      setProgress(`Looking up ${uniqueNames.length} unique medicines\u2026`);

      const res = await fetch("/api/bulk-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drugNames: uniqueNames }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Lookup failed (${res.status})`);
      }

      const { results: lookupResults } = (await res.json()) as {
        results: LookupResult[];
      };

      const lookupMap = new Map<string, LookupResult>();
      for (const lr of lookupResults) {
        lookupMap.set(lr.drugName, lr);
      }

      const merged: ResultRow[] = parsed.map((row) => {
        const lookup = lookupMap.get(row.drugName) ?? {
          drugName: row.drugName,
          matchedDrug: null,
          matchConfidence: "none" as const,
          shortages: [],
        };
        const hasBackorder = (row.backorderQty ?? 0) > 0;
        return {
          ...row,
          lookup,
          worstSeverity: lookup.matchedDrug ? worstSev(lookup.shortages) : "none",
          sortRank: sortRank(lookup, hasBackorder),
          hasBackorder,
        };
      });

      merged.sort((a, b) => a.sortRank - b.sortRank);

      setRows(merged);
      setPhase("done");
      setProgress("");
    } catch (err) {
      console.error("[BulkUpload] error:", err);
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
      setPhase("error");
    }
  }, [file]);

  useEffect(() => {
    processFile();
  }, [processFile]);

  /* ── PDF Export ── */
  async function exportPDF() {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF();

    doc.setFontSize(18);
    doc.setTextColor(15, 23, 42);
    doc.text("Mederti \u2014 Drug Shortage Report", 14, 22);
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated: ${new Date().toLocaleDateString("en-AU", { year: "numeric", month: "long", day: "numeric" })}`, 14, 30);
    doc.text(`Source file: ${file.name}`, 14, 36);

    const withShortagesPDF = rows.filter((r) => r.lookup.shortages.length > 0);
    const critCountPDF = rows.filter((r) =>
      r.lookup.shortages.some((s) => s.severity === "critical")
    ).length;
    const boPDF = rows.filter((r) => r.hasBackorder && r.lookup.shortages.length > 0).length;

    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `${rows.length} medicines \u00B7 ${withShortagesPDF.length} with shortages \u00B7 ${critCountPDF} critical \u00B7 ${boPDF} on backorder`,
      14, 48
    );

    autoTable(doc, {
      startY: 56,
      head: [["#", "Drug Description", "Supplier", "Qty Ord", "Qty BO", "Shortages", "Countries", "Severity"]],
      body: rows.map((r, i) => [
        String(i + 1),
        r.drugDescription,
        r.supplier ?? "-",
        r.quantity != null ? String(r.quantity) : "-",
        r.backorderQty != null ? String(r.backorderQty) : "-",
        r.lookup.shortages.length > 0 ? `${r.lookup.shortages.length} active` : "None",
        [...new Set(r.lookup.shortages.map((s) => s.country_code).filter(Boolean))].join(", ") || "-",
        SEV[r.worstSeverity]?.label ?? "-",
      ]),
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: [13, 148, 136], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 10 },
        3: { cellWidth: 18 },
        4: { cellWidth: 18 },
      },
    });

    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      const y = doc.internal.pageSize.height - 10;
      doc.text(
        "Generated by Mederti \u00B7 mederti.vercel.app \u00B7 Data sourced from 30+ regulatory bodies",
        14, y
      );
      doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.width - 40, y);
    }

    doc.save(`mederti-shortage-report-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  /* ── Summary stats ── */
  const withShortages = rows.filter((r) => r.lookup.shortages.length > 0).length;
  const criticalCount = rows.filter((r) =>
    r.lookup.shortages.some((s) => s.severity === "critical")
  ).length;
  const boWithShortage = rows.filter((r) => r.hasBackorder && r.lookup.shortages.length > 0).length;

  /* ── Render ── */
  return (
    <div style={{ maxWidth: 1000, width: "100%", margin: "0 auto", padding: "24px 24px 60px" }}>

      {/* Back + file info */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 20,
      }}>
        <button onClick={onClose} style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "none", border: "none", cursor: "pointer",
          fontSize: 13, color: "var(--app-text-3)",
          fontFamily: "var(--font-inter), sans-serif",
        }}>
          <ArrowLeft style={{ width: 14, height: 14 }} />
          Back to search
        </button>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          fontSize: 13, color: "var(--app-text-3)",
        }}>
          <FileSpreadsheet style={{ width: 14, height: 14, color: "var(--teal)" }} />
          {file.name}
        </div>
      </div>

      {/* Loading states */}
      {(phase === "parsing" || phase === "detecting-columns" || phase === "looking-up") && (
        <div style={{
          background: "#fff", border: "1px solid var(--app-border)",
          borderRadius: 12, padding: "48px 24px", textAlign: "center",
        }}>
          <Loader2 style={{
            width: 24, height: 24, color: "var(--teal)",
            animation: "spin 1s linear infinite", margin: "0 auto 16px",
          }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--app-text)", marginBottom: 6 }}>
            {phase === "parsing" ? "Parsing file\u2026"
              : phase === "detecting-columns" ? "Analyzing column layout\u2026"
              : "Looking up medicines\u2026"}
          </div>
          <div style={{ fontSize: 13, color: "var(--app-text-4)" }}>{progress}</div>
        </div>
      )}

      {/* Error state */}
      {phase === "error" && (
        <div style={{
          background: "var(--crit-bg)", border: "1px solid var(--crit-b)",
          borderRadius: 12, padding: "32px 24px", textAlign: "center",
        }}>
          <AlertTriangle style={{ width: 24, height: 24, color: "var(--crit)", margin: "0 auto 12px" }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--crit)", marginBottom: 6 }}>
            Upload failed
          </div>
          <div style={{ fontSize: 13, color: "var(--app-text-2)", maxWidth: 500, margin: "0 auto" }}>
            {error}
          </div>
          <button onClick={onClose} style={{
            marginTop: 16, padding: "8px 20px", borderRadius: 8,
            background: "var(--crit)", color: "#fff", border: "none",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
            fontFamily: "var(--font-inter), sans-serif",
          }}>
            Try again
          </button>
        </div>
      )}

      {/* Results */}
      {phase === "done" && (
        <>
          {/* Summary bar */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12,
            marginBottom: 16,
          }}>
            {[
              { label: "Medicines checked", value: rows.length, color: "var(--app-text)" },
              { label: "With active shortages", value: withShortages, color: "var(--high)" },
              { label: "Critical", value: criticalCount, color: "var(--crit)" },
              { label: "On backorder + shortage", value: boWithShortage, color: "#f59e0b" },
            ].map((s) => (
              <div key={s.label} style={{
                background: "#fff", border: "1px solid var(--app-border)",
                borderRadius: 10, padding: "14px 16px",
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                  letterSpacing: "0.08em", color: "var(--app-text-4)", marginBottom: 4,
                }}>
                  {s.label}
                </div>
                <div style={{
                  fontSize: 24, fontWeight: 700, color: s.color,
                  fontFamily: "var(--font-dm-mono), monospace", lineHeight: 1,
                }}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 13, color: "var(--app-text-3)" }}>
              {withShortages > 0 ? (
                <>
                  <span style={{ fontWeight: 600, color: "var(--app-text)" }}>
                    {withShortages} of {rows.length}
                  </span>{" "}
                  medicines have active shortages
                  {criticalCount > 0 && (
                    <> &middot; <span style={{ fontWeight: 600, color: "var(--crit)" }}>{criticalCount} critical</span></>
                  )}
                  {boWithShortage > 0 && (
                    <> &middot; <span style={{ fontWeight: 600, color: "#f59e0b" }}>{boWithShortage} already on backorder</span></>
                  )}
                </>
              ) : (
                "No active shortages found for your medicines"
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={downloadSampleCSV} style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "7px 14px", borderRadius: 8,
                background: "var(--app-bg)", border: "1px solid var(--app-border)",
                fontSize: 12, color: "var(--app-text-3)", cursor: "pointer",
                fontFamily: "var(--font-inter), sans-serif",
              }}>
                <FileDown style={{ width: 13, height: 13 }} />
                Sample CSV
              </button>
              <button onClick={exportPDF} style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "7px 14px", borderRadius: 8,
                background: "var(--teal)", border: "none",
                fontSize: 12, fontWeight: 600, color: "#fff", cursor: "pointer",
                fontFamily: "var(--font-inter), sans-serif",
              }}>
                <Download style={{ width: 13, height: 13 }} />
                Download Report
              </button>
            </div>
          </div>

          {/* 500-row truncation banner */}
          {truncated && (
            <div style={{
              background: "var(--teal-bg)", border: "1px solid var(--teal-b)",
              borderRadius: 10, padding: "12px 16px", marginBottom: 16,
              display: "flex", alignItems: "center", justifyContent: "space-between",
              fontSize: 13,
            }}>
              <span style={{ color: "var(--app-text-2)" }}>
                Showing 500 of {totalParsed.toLocaleString()} rows.
                For unlimited bulk lookups,{" "}
                <Link href="/pricing" style={{ color: "var(--teal)", fontWeight: 600, textDecoration: "none" }}>
                  contact us for enterprise access
                </Link>.
              </span>
            </div>
          )}

          {/* Results table */}
          <div style={{
            background: "#fff", border: "1px solid var(--app-border)",
            borderRadius: 12, overflow: "hidden",
          }}>
            {/* Table header */}
            <div className="bu-row" style={{
              display: "grid",
              gridTemplateColumns: "36px 1.5fr 0.8fr 64px 64px 100px 70px 80px 36px",
              gap: 8, padding: "10px 16px",
              borderBottom: "1px solid var(--app-border)",
              background: "var(--app-bg)",
            }}>
              {["#", "Drug Description", "Supplier", "Qty Ord", "Qty BO", "Status", "Severity", "Countries", ""].map((h) => (
                <span key={h} style={{
                  fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                  letterSpacing: "0.08em", color: "var(--app-text-4)",
                }}>
                  {h}
                </span>
              ))}
            </div>

            {/* Table body */}
            {rows.map((r, i) => {
              const sev = SEV[r.worstSeverity] ?? SEV.ok;
              const noMatch = !r.lookup.matchedDrug;
              const countries = [...new Set(r.lookup.shortages.map((s) => s.country_code).filter(Boolean))] as string[];
              const matchedName = r.lookup.matchedDrug?.generic_name;
              const showMatchedName = matchedName && matchedName.toLowerCase() !== r.drugDescription.toLowerCase();

              return (
                <div key={i} className="bu-row" style={{
                  display: "grid",
                  gridTemplateColumns: "36px 1.5fr 0.8fr 64px 64px 100px 70px 80px 36px",
                  gap: 8, padding: "10px 16px", alignItems: "center",
                  borderBottom: i < rows.length - 1 ? "1px solid var(--app-bg-2)" : "none",
                  borderLeft: r.hasBackorder ? "3px solid #f59e0b" : "3px solid transparent",
                  opacity: noMatch ? 0.6 : 1,
                }}>
                  {/* # */}
                  <span style={{
                    fontSize: 11, color: "var(--app-text-4)",
                    fontFamily: "var(--font-dm-mono), monospace",
                  }}>
                    {i + 1}
                  </span>

                  {/* Drug description + matched name subtitle */}
                  <div style={{ overflow: "hidden" }}>
                    <div style={{
                      fontSize: 13, fontWeight: 500, color: "var(--app-text)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {r.drugDescription}
                    </div>
                    {showMatchedName && (
                      <div style={{
                        fontSize: 11, color: "var(--app-text-4)", marginTop: 1,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {matchedName}
                      </div>
                    )}
                  </div>

                  {/* Supplier */}
                  <span style={{
                    fontSize: 12, color: "var(--app-text-3)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {r.supplier ?? "\u2014"}
                  </span>

                  {/* Qty Ordered */}
                  <span style={{
                    fontSize: 12, color: "var(--app-text-3)",
                    fontFamily: "var(--font-dm-mono), monospace",
                  }}>
                    {r.quantity != null ? r.quantity.toLocaleString() : "\u2014"}
                  </span>

                  {/* Qty Backordered */}
                  <span style={{
                    fontSize: 12,
                    color: r.hasBackorder ? "#f59e0b" : "var(--app-text-3)",
                    fontWeight: r.hasBackorder ? 600 : 400,
                    fontFamily: "var(--font-dm-mono), monospace",
                  }}>
                    {r.backorderQty != null ? r.backorderQty.toLocaleString() : "\u2014"}
                  </span>

                  {/* Status badge */}
                  <div>
                    {noMatch ? (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "3px 8px",
                        borderRadius: 20, background: "var(--app-bg)",
                        color: "var(--app-text-4)", border: "1px solid var(--app-border)",
                        textTransform: "uppercase", letterSpacing: "0.04em",
                      }}>
                        N/A
                      </span>
                    ) : r.lookup.shortages.length > 0 ? (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "3px 8px",
                        borderRadius: 20, background: sev.bg,
                        color: sev.color, border: `1px solid ${sev.border}`,
                        textTransform: "uppercase", letterSpacing: "0.04em",
                      }}>
                        {r.lookup.shortages.length} Active
                      </span>
                    ) : (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "3px 8px",
                        borderRadius: 20, background: "var(--low-bg)",
                        color: "var(--low)", border: "1px solid var(--low-b)",
                        textTransform: "uppercase", letterSpacing: "0.04em",
                      }}>
                        OK
                      </span>
                    )}
                  </div>

                  {/* Severity dot + label */}
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    {!noMatch && (
                      <>
                        <span style={{
                          width: 7, height: 7, borderRadius: "50%",
                          background: sev.color, display: "inline-block", flexShrink: 0,
                        }} />
                        <span style={{
                          fontSize: 11, color: sev.color, fontWeight: 500,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {sev.label}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Countries */}
                  <div style={{
                    display: "flex", gap: 2, fontSize: 13, lineHeight: 1,
                    overflow: "hidden",
                  }}>
                    {countries.length > 0
                      ? countries.slice(0, 5).map((cc) => (
                          <span key={cc} title={cc}>{FLAGS[cc] ?? "\u{1F310}"}</span>
                        ))
                      : <span style={{ fontSize: 12, color: "var(--app-text-4)" }}>{"\u2014"}</span>
                    }
                    {countries.length > 5 && (
                      <span style={{
                        fontSize: 10, color: "var(--app-text-4)",
                        fontFamily: "var(--font-dm-mono), monospace",
                      }}>
                        +{countries.length - 5}
                      </span>
                    )}
                  </div>

                  {/* Link */}
                  {r.lookup.matchedDrug ? (
                    <Link href={`/drugs/${r.lookup.matchedDrug.drug_id}`}
                      style={{ display: "flex", alignItems: "center", color: "var(--teal)" }}
                      title="View drug detail"
                    >
                      <ExternalLink style={{ width: 14, height: 14, strokeWidth: 1.5 }} />
                    </Link>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer info */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginTop: 12, fontSize: 11, color: "var(--app-text-4)",
          }}>
            <span>
              Data sourced from 30+ regulatory bodies &middot; Updated in real-time
            </span>
            <button onClick={downloadSampleCSV} style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 11, color: "var(--teal)", textDecoration: "underline",
              fontFamily: "var(--font-inter), sans-serif",
            }}>
              Download sample CSV
            </button>
          </div>
        </>
      )}

      {/* Responsive + animation styles */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @media (max-width: 800px) {
          .bu-row {
            grid-template-columns: 28px 1fr 80px 70px 36px !important;
          }
          .bu-row > :nth-child(3),
          .bu-row > :nth-child(4),
          .bu-row > :nth-child(5),
          .bu-row > :nth-child(8) {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
