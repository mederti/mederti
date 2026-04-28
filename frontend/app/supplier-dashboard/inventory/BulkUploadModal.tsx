"use client";

import { useState } from "react";
import { X, Upload, CheckCircle2, AlertCircle, Download, FileText } from "lucide-react";

interface BulkUploadModalProps {
  onClose: () => void;
  onComplete: () => void;
}

interface ParsedRow {
  drug_name: string;
  quantity_available?: string;
  unit_price?: string;
  currency?: string;
  pack_size?: string;
  countries?: string;
  notes?: string;
  available_until?: string;
}

interface ResultRow {
  row: number;
  status: string;
  drug?: string;
  message?: string;
}

export default function BulkUploadModal({ onClose, onComplete }: BulkUploadModalProps) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [filename, setFilename] = useState("");
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<{ summary: { total: number; saved: number; errors: number; unmatched: number }; results: ResultRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function downloadTemplate() {
    const csv = [
      "drug_name,quantity_available,unit_price,currency,pack_size,countries,notes,available_until",
      "Amoxicillin,10000 units,12.50,AUD,100 capsules,AU;NZ,48hr delivery,2026-12-31",
      "Paracetamol,50000 units,2.20,AUD,500 tablets,AU,MOQ 1000,",
      "Cisplatin,5000 vials,180.00,USD,50ml vial,US;CA;GB,Cold chain certified,",
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mederti-inventory-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFile(file: File) {
    setError(null);
    setResults(null);
    setRows([]);
    setFilename(file.name);
    setParsing(true);

    try {
      const text = await file.text();
      const lines = text.trim().split(/\r?\n/);
      if (lines.length < 2) {
        setError("File appears empty or missing rows.");
        setParsing(false);
        return;
      }

      // Parse CSV header
      const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
      const drugNameIdx = headers.findIndex(h => ["drug_name", "drug", "name", "generic_name", "product"].includes(h));
      if (drugNameIdx === -1) {
        setError("Couldn't find a 'drug_name' column. CSV must have a column named 'drug_name', 'drug', 'name', 'generic_name' or 'product'.");
        setParsing(false);
        return;
      }

      const parsed: ParsedRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i]);
        if (cells.length === 0 || cells.every(c => !c.trim())) continue;
        const get = (key: string) => {
          const idx = headers.indexOf(key);
          return idx >= 0 && idx < cells.length ? cells[idx].trim() : "";
        };
        const drugName = cells[drugNameIdx]?.trim();
        if (!drugName) continue;
        parsed.push({
          drug_name: drugName,
          quantity_available: get("quantity_available") || get("quantity") || get("qty"),
          unit_price: get("unit_price") || get("price"),
          currency: get("currency") || "AUD",
          pack_size: get("pack_size") || get("pack"),
          countries: get("countries") || get("country"),
          notes: get("notes") || get("note"),
          available_until: get("available_until") || get("expires"),
        });
      }

      if (parsed.length === 0) {
        setError("No valid data rows found in file.");
      } else if (parsed.length > 500) {
        setError(`File has ${parsed.length} rows — max 500 per upload. Split into multiple files.`);
      } else {
        setRows(parsed);
      }
    } catch (e) {
      setError("Failed to parse file: " + String(e));
    } finally {
      setParsing(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/supplier/inventory/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to import");
      } else {
        setResults(data);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function close() {
    if (results) onComplete();
    else onClose();
  }

  return (
    <div onClick={close} style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "white", borderRadius: 14, maxWidth: 760, width: "100%",
        maxHeight: "90vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
      }}>
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--app-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--app-text-4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
              Bulk import
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Upload inventory CSV</div>
          </div>
          <button onClick={close} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--app-text-4)" }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 24 }}>
          {!rows.length && !results && (
            <>
              <p style={{ fontSize: 14, color: "var(--app-text-3)", lineHeight: 1.5, marginTop: 0 }}>
                Upload a CSV with your inventory. We&apos;ll match drug names to our catalogue of <strong>10,721 drugs</strong> automatically.
              </p>
              <button
                onClick={downloadTemplate}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  fontSize: 13, fontWeight: 600,
                  background: "var(--app-bg)", color: "var(--teal)",
                  border: "1px solid var(--teal-b)", borderRadius: 6,
                  padding: "8px 14px", cursor: "pointer", marginBottom: 20,
                }}
              >
                <Download size={13} /> Download CSV template
              </button>

              {/* File drop / upload */}
              <label style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                padding: "40px 24px", border: "2px dashed var(--app-border)", borderRadius: 10,
                cursor: "pointer", background: "var(--app-bg)",
              }}>
                <Upload size={28} color="var(--app-text-4)" style={{ marginBottom: 10 }} />
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--app-text)" }}>
                  Click to choose a CSV file
                </div>
                <div style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 6 }}>
                  Up to 500 rows per upload
                </div>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
                  style={{ display: "none" }}
                />
              </label>

              {parsing && <div style={{ marginTop: 14, fontSize: 13, color: "var(--app-text-4)" }}>Parsing…</div>}
              {error && (
                <div style={{ marginTop: 14, padding: 12, background: "var(--crit-bg)", color: "var(--crit)", border: "1px solid var(--crit-b)", borderRadius: 6, fontSize: 13 }}>
                  <AlertCircle size={14} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} /> {error}
                </div>
              )}

              <div style={{ marginTop: 20, padding: 14, background: "var(--app-bg)", borderRadius: 8, fontSize: 12, color: "var(--app-text-4)", lineHeight: 1.6 }}>
                <strong style={{ color: "var(--app-text)" }}>Required columns:</strong> drug_name<br />
                <strong style={{ color: "var(--app-text)" }}>Optional:</strong> quantity_available, unit_price, currency, pack_size, countries (comma-separated codes), notes, available_until (YYYY-MM-DD)
              </div>
            </>
          )}

          {rows.length > 0 && !results && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{filename}</div>
                  <div style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 2 }}>
                    {rows.length} row{rows.length === 1 ? "" : "s"} ready to import
                  </div>
                </div>
                <button onClick={() => { setRows([]); setFilename(""); }} style={{ fontSize: 12, color: "var(--teal)", background: "none", border: "none", cursor: "pointer" }}>
                  Choose different file
                </button>
              </div>

              {/* Preview first 8 rows */}
              <div style={{ border: "1px solid var(--app-border)", borderRadius: 8, overflow: "hidden", maxHeight: 280, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "var(--app-bg)" }}>
                      <th style={th}>#</th>
                      <th style={th}>Drug</th>
                      <th style={th}>Qty</th>
                      <th style={th}>Price</th>
                      <th style={th}>Countries</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((r, i) => (
                      <tr key={i} style={{ borderTop: "1px solid var(--app-border)" }}>
                        <td style={td}>{i + 1}</td>
                        <td style={{ ...td, fontWeight: 500 }}>{r.drug_name}</td>
                        <td style={td}>{r.quantity_available || "—"}</td>
                        <td style={td}>{r.unit_price ? `${r.currency || "AUD"} ${r.unit_price}` : "—"}</td>
                        <td style={td}>{r.countries || "Global"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 50 && (
                  <div style={{ padding: 10, fontSize: 12, color: "var(--app-text-4)", textAlign: "center", borderTop: "1px solid var(--app-border)" }}>
                    + {rows.length - 50} more rows
                  </div>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                <button onClick={close} style={{ padding: "10px 16px", fontSize: 13, fontWeight: 500, background: "white", color: "var(--app-text)", border: "1px solid var(--app-border)", borderRadius: 6, cursor: "pointer" }}>
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  style={{
                    padding: "10px 20px", fontSize: 13, fontWeight: 600,
                    background: "var(--teal)", color: "white", border: "none", borderRadius: 6,
                    cursor: submitting ? "wait" : "pointer",
                    display: "inline-flex", alignItems: "center", gap: 8,
                  }}
                >
                  <Upload size={13} /> {submitting ? `Importing ${rows.length}…` : `Import ${rows.length} listing${rows.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </>
          )}

          {results && (
            <>
              <div style={{ textAlign: "center", padding: "20px 0 28px" }}>
                <CheckCircle2 size={48} color="var(--low)" style={{ margin: "0 auto 12px" }} />
                <div style={{ fontSize: 18, fontWeight: 700 }}>Import complete</div>
                <div style={{ fontSize: 13, color: "var(--app-text-4)", marginTop: 6 }}>
                  {results.summary.saved} saved · {results.summary.unmatched} unmatched · {results.summary.errors - results.summary.unmatched} errors
                </div>
              </div>

              {/* Result detail */}
              {(results.summary.unmatched > 0 || results.summary.errors > 0) && (
                <div style={{ border: "1px solid var(--app-border)", borderRadius: 8, padding: 12, fontSize: 12, marginBottom: 16, maxHeight: 200, overflowY: "auto" }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Issues:</div>
                  {results.results.filter(r => r.status !== "saved").map((r, i) => (
                    <div key={i} style={{ padding: "4px 0", color: "var(--app-text-3)" }}>
                      Row {r.row}: <strong>{r.drug}</strong> — {r.message}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button onClick={close} style={{ padding: "10px 20px", fontSize: 13, fontWeight: 600, background: "var(--teal)", color: "white", border: "none", borderRadius: 6, cursor: "pointer" }}>
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "8px 10px", textAlign: "left", fontWeight: 600,
  color: "var(--app-text-4)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em",
};
const td: React.CSSProperties = {
  padding: "8px 10px", color: "var(--app-text)",
};

// Simple CSV line parser supporting quoted fields
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = false;
      } else cur += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
