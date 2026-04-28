"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Package, Plus, Trash2, Search, X, ArrowRight, CheckCircle2, Upload } from "lucide-react";
import { useAutocomplete } from "@/lib/hooks/use-autocomplete";
import AutocompleteDropdown from "@/app/components/autocomplete-dropdown";
import BulkUploadModal from "./BulkUploadModal";

const FLAGS: Record<string, string> = {
  AU: "🇦🇺", US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", ES: "🇪🇸",
  NZ: "🇳🇿", SG: "🇸🇬", IE: "🇮🇪", NO: "🇳🇴", FI: "🇫🇮", CH: "🇨🇭", BE: "🇧🇪",
  NL: "🇳🇱", JP: "🇯🇵", PT: "🇵🇹", GR: "🇬🇷", MY: "🇲🇾", AE: "🇦🇪", EU: "🇪🇺",
};

const COUNTRY_OPTIONS = Object.keys(FLAGS);

interface InventoryItem {
  id: string;
  drug_id: string;
  drug_name: string;
  countries: string[];
  quantity_available: string | null;
  unit_price: number | null;
  currency: string;
  pack_size: string | null;
  notes: string | null;
  available_until: string | null;
  status: string;
  updated_at: string;
}

const STATUS_STYLE: Record<string, { label: string; bg: string; color: string }> = {
  available: { label: "AVAILABLE", bg: "var(--low-bg)", color: "var(--low)" },
  limited:   { label: "LIMITED",   bg: "var(--high-bg)", color: "var(--high)" },
  depleted:  { label: "DEPLETED",  bg: "var(--app-bg)",  color: "var(--app-text-4)" },
};

export default function SupplierInventoryClient() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileRequired, setProfileRequired] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [adding, setAdding] = useState(false);

  // Add form state
  const [selectedDrug, setSelectedDrug] = useState<{ id: string; name: string } | null>(null);
  const autocomplete = useAutocomplete({
    onSelect: (item) => {
      setSelectedDrug({ id: item.id, name: item.name });
      autocomplete.clear();
    },
    limit: 6,
  });
  const [countries, setCountries] = useState<string[]>([]);
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [currency, setCurrency] = useState("AUD");
  const [packSize, setPackSize] = useState("");
  const [availableUntil, setAvailableUntil] = useState("");
  const [notes, setNotes] = useState("");

  function loadItems() {
    setLoading(true);
    fetch("/api/supplier/inventory")
      .then(r => r.json())
      .then(d => {
        setItems(d.inventory ?? []);
        setProfileRequired(!!d.profile_required);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadItems(); }, []);

  function resetForm() {
    setSelectedDrug(null);
    autocomplete.clear();
    setCountries([]);
    setQuantity("");
    setUnitPrice("");
    setCurrency("AUD");
    setPackSize("");
    setAvailableUntil("");
    setNotes("");
  }

  async function handleAdd() {
    if (!selectedDrug) return;
    setAdding(true);
    try {
      const res = await fetch("/api/supplier/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          drug_id: selectedDrug.id,
          countries,
          quantity_available: quantity || null,
          unit_price: unitPrice ? Number(unitPrice) : null,
          currency,
          pack_size: packSize || null,
          notes: notes || null,
          available_until: availableUntil || null,
          status: "available",
        }),
      });
      if (res.ok) {
        resetForm();
        setShowAdd(false);
        loadItems();
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this inventory listing?")) return;
    await fetch("/api/supplier/inventory", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    loadItems();
  }

  function toggleCountry(code: string) {
    setCountries(c => c.includes(code) ? c.filter(x => x !== code) : [...c, code]);
  }

  if (loading) {
    return <div style={{ maxWidth: 960, margin: "0 auto", padding: "48px 24px", color: "var(--app-text-4)" }}>Loading…</div>;
  }

  if (profileRequired) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ textAlign: "center", padding: "60px 32px", background: "var(--app-bg)", borderRadius: 12, border: "1px solid var(--app-border)" }}>
          <Package size={36} color="var(--teal)" style={{ margin: "0 auto 16px" }} />
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Set up your supplier profile</h1>
          <p style={{ fontSize: 14, color: "var(--app-text-4)", marginBottom: 24 }}>
            You need a supplier profile before broadcasting inventory.
          </p>
          <Link href="/supplier-dashboard/profile" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "12px 24px", background: "var(--teal)", color: "white",
            borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: "none",
          }}>
            Set up profile <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--app-text-4)", marginBottom: 6 }}>
            Supplier Dashboard
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Inventory Broadcast</h1>
          <p style={{ fontSize: 14, color: "var(--app-text-4)" }}>
            Drugs you list here appear on shortage pages so buyers can find you. <strong style={{ color: "var(--app-text)" }}>{items.length}</strong> active listings.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setShowBulk(true)}
            style={{
              padding: "10px 16px", fontSize: 13, fontWeight: 600,
              background: "white", color: "var(--app-text)",
              border: "1px solid var(--app-border)", borderRadius: 6,
              cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8,
            }}
          >
            <Upload size={14} /> Bulk import CSV
          </button>
          <button
            onClick={() => setShowAdd(s => !s)}
            style={{
              padding: "10px 18px", fontSize: 13, fontWeight: 600,
              background: showAdd ? "var(--app-bg)" : "var(--teal)",
              color: showAdd ? "var(--app-text)" : "white",
              border: showAdd ? "1px solid var(--app-border)" : "none",
              borderRadius: 6, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8,
            }}
          >
            {showAdd ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Add single listing</>}
          </button>
        </div>
      </div>

      {showBulk && (
        <BulkUploadModal
          onClose={() => setShowBulk(false)}
          onComplete={() => { setShowBulk(false); loadItems(); }}
        />
      )}

      {/* Add form */}
      {showAdd && (
        <div style={{ padding: 24, background: "var(--app-card)", border: "1px solid var(--app-border)", borderRadius: 12, marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>New inventory listing</div>

          {/* Drug search */}
          <div style={{ position: "relative", marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--app-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Drug <span style={{ color: "var(--crit)" }}>*</span>
            </label>
            {selectedDrug ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--teal-bg)", border: "1px solid var(--teal-b)", borderRadius: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{selectedDrug.name}</span>
                <button onClick={() => setSelectedDrug(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--teal)" }}>
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div ref={autocomplete.containerRef} style={{ position: "relative" }}>
                <div style={{ position: "relative" }}>
                  <Search size={14} color="var(--app-text-4)" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                  <input
                    type="text"
                    {...autocomplete.inputProps}
                    placeholder="Search by drug name…"
                    style={{ width: "100%", padding: "10px 12px 10px 36px", fontSize: 14, border: "1px solid var(--app-border)", borderRadius: 6, background: "var(--app-bg)", color: "var(--app-text)" }}
                  />
                </div>
                {autocomplete.isOpen && (
                  <AutocompleteDropdown
                    items={autocomplete.items}
                    cursor={autocomplete.cursor}
                    loading={autocomplete.loading}
                    query={autocomplete.query}
                    listId={autocomplete.inputProps["aria-controls"]}
                    onSelect={(item) => {
                      setSelectedDrug({ id: item.id, name: item.name });
                      autocomplete.clear();
                    }}
                    onHover={() => {}}
                  />
                )}
              </div>
            )}
          </div>

          {/* Countries */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--app-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Available in countries
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {COUNTRY_OPTIONS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCountry(c)}
                  style={{
                    padding: "6px 10px", fontSize: 13,
                    background: countries.includes(c) ? "var(--teal-bg)" : "var(--app-bg)",
                    border: `1px solid ${countries.includes(c) ? "var(--teal-b)" : "var(--app-border)"}`,
                    borderRadius: 4, cursor: "pointer",
                    color: countries.includes(c) ? "var(--teal)" : "var(--app-text)",
                    fontWeight: countries.includes(c) ? 600 : 400,
                  }}
                >
                  {FLAGS[c]} {c}
                </button>
              ))}
            </div>
          </div>

          {/* Quantity + Pack size */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--app-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Quantity available
              </label>
              <input
                type="text"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder="e.g. 10,000 units"
                style={{ width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid var(--app-border)", borderRadius: 6, background: "var(--app-bg)", color: "var(--app-text)" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--app-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Pack size
              </label>
              <input
                type="text"
                value={packSize}
                onChange={e => setPackSize(e.target.value)}
                placeholder="e.g. 100 tablets"
                style={{ width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid var(--app-border)", borderRadius: 6, background: "var(--app-bg)", color: "var(--app-text)" }}
              />
            </div>
          </div>

          {/* Price + currency + available until */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 14, marginBottom: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--app-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Unit price (optional)
              </label>
              <input
                type="number"
                step="0.01"
                value={unitPrice}
                onChange={e => setUnitPrice(e.target.value)}
                placeholder="0.00"
                style={{ width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid var(--app-border)", borderRadius: 6, background: "var(--app-bg)", color: "var(--app-text)" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--app-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Currency
              </label>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid var(--app-border)", borderRadius: 6, background: "var(--app-bg)", color: "var(--app-text)" }}
              >
                {["AUD", "USD", "EUR", "GBP", "CAD", "JPY", "SGD", "CHF"].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--app-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Available until
              </label>
              <input
                type="date"
                value={availableUntil}
                onChange={e => setAvailableUntil(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid var(--app-border)", borderRadius: 6, background: "var(--app-bg)", color: "var(--app-text)" }}
              />
            </div>
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--app-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Notes
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="MOQ, delivery time, certification, etc."
              rows={2}
              style={{ width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid var(--app-border)", borderRadius: 6, background: "var(--app-bg)", color: "var(--app-text)", fontFamily: "inherit", resize: "vertical" }}
            />
          </div>

          {/* Submit */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              onClick={handleAdd}
              disabled={!selectedDrug || adding}
              style={{
                padding: "10px 20px", fontSize: 14, fontWeight: 600,
                background: "var(--teal)", color: "white", border: "none", borderRadius: 6,
                cursor: selectedDrug ? "pointer" : "not-allowed",
                opacity: selectedDrug ? 1 : 0.5,
              }}
            >
              {adding ? "Posting…" : "Post listing"}
            </button>
          </div>
        </div>
      )}

      {/* Inventory list */}
      {items.length === 0 ? (
        <div style={{ padding: "60px 24px", textAlign: "center", background: "var(--app-bg)", borderRadius: 10, border: "1px solid var(--app-border)" }}>
          <Package size={32} color="var(--app-text-4)" style={{ margin: "0 auto 14px" }} />
          <div style={{ fontSize: 15, fontWeight: 600 }}>No inventory listed yet</div>
          <div style={{ fontSize: 13, color: "var(--app-text-4)", marginTop: 6 }}>
            Add drugs you have in stock to appear on shortage pages and get matched to buyers.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map(item => {
            const sStyle = STATUS_STYLE[item.status] ?? STATUS_STYLE.available;
            return (
              <div key={item.id} style={{
                padding: 16, background: "var(--app-card)", border: "1px solid var(--app-border)", borderRadius: 10,
                display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 16, alignItems: "center",
              }}>
                <div>
                  <Link href={`/drugs/${item.drug_id}`} style={{ fontSize: 15, fontWeight: 600, color: "var(--app-text)", textDecoration: "none" }}>
                    {item.drug_name}
                  </Link>
                  <div style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 4 }}>
                    {item.notes || (item.pack_size ? `Pack: ${item.pack_size}` : "—")}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--app-text-4)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>Quantity</div>
                  <div style={{ fontSize: 13 }}>{item.quantity_available || "—"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--app-text-4)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>Price</div>
                  <div style={{ fontSize: 13 }}>{item.unit_price ? `${item.currency} ${item.unit_price}` : "—"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--app-text-4)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>Countries</div>
                  <div style={{ fontSize: 14 }}>{item.countries.length === 0 ? "Global" : item.countries.map(c => FLAGS[c] ?? c).join(" ")}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
                    background: sStyle.bg, color: sStyle.color, letterSpacing: "0.04em",
                  }}>{sStyle.label}</span>
                  <button
                    onClick={() => handleDelete(item.id)}
                    title="Remove listing"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--app-text-4)", padding: 4 }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
