"use client";

import Link from "next/link";
import SiteNav from "@/app/components/landing-nav";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import SiteFooter from "@/app/components/site-footer";

const ROLE_OPTIONS = [
  { value: "default",     label: "Default" },
  { value: "pharmacist",  label: "Pharmacist" },
  { value: "hospital",    label: "Hospital" },
  { value: "supplier",    label: "Supplier" },
  { value: "government",  label: "Government" },
] as const;

interface WatchlistRow {
  id: string;
  drug_id: string;
  is_active: boolean;
  notification_channels: { email: boolean; sms: boolean; webhook: string | null };
  created_at: string;
  drugs: { generic_name: string; brand_names: string[] }[] | null;
}

interface EnquiryRow {
  id: string;
  drug_id: string | null;
  drug_name: string;
  quantity: string | null;
  urgency: string;
  organisation: string | null;
  partner_id: string;
  status: string;
  country: string;
  created_at: string;
}

const PARTNER_NAMES: Record<string, string> = {
  "barwon-au": "Barwon Pharma",
  "alliance-gb": "Alliance Healthcare",
};

function NotSignedIn() {
  return (
    <div style={{ textAlign: "center", padding: "80px 20px" }}>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "center" }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--app-text)", marginBottom: 8, letterSpacing: "-0.02em" }}>
        Sign in to access your account
      </h2>
      <p style={{ fontSize: 14, color: "var(--app-text-3)", marginBottom: 28, lineHeight: 1.65, maxWidth: 360, margin: "0 auto 28px" }}>
        Your watchlist, alert preferences, and account settings are protected.
      </p>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        <Link href="/login?next=/account" style={{
          fontSize: 14, fontWeight: 600, padding: "11px 28px",
          background: "var(--teal)", color: "#fff", borderRadius: 8, textDecoration: "none",
        }}>
          Sign in
        </Link>
        <Link href="/signup" style={{
          fontSize: 14, fontWeight: 500, padding: "11px 28px",
          background: "#fff", color: "var(--app-text-2)", border: "1px solid var(--app-border-2)", borderRadius: 8, textDecoration: "none",
        }}>
          Create account
        </Link>
      </div>
    </div>
  );
}

export default function AccountPage() {
  const supabase = createBrowserClient();
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [watchlist, setWatchlist] = useState<WatchlistRow[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [enquiries, setEnquiries] = useState<EnquiryRow[]>([]);
  const [enquiriesLoading, setEnquiriesLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"watchlist" | "enquiries" | "settings">("watchlist");
  const [role, setRole] = useState<string>("default");
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleSaved, setRoleSaved] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user) {
        fetchWatchlist(session.user.id);
        fetchEnquiries(session.user.id);
        // Fetch user profile for role
        supabase.from("user_profiles").select("role").eq("user_id", session.user.id).single()
          .then(({ data }) => { if (data?.role) setRole(data.role); });
      }
    });
  }, []);

  async function fetchWatchlist(uid: string) {
    setWatchlistLoading(true);
    const { data } = await supabase
      .from("user_watchlists")
      .select("id, drug_id, is_active, notification_channels, created_at, drugs(generic_name, brand_names)")
      .eq("user_id", uid)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    setWatchlist((data ?? []) as WatchlistRow[]);
    setWatchlistLoading(false);
  }

  async function fetchEnquiries(uid: string) {
    setEnquiriesLoading(true);
    const { data } = await supabase
      .from("supplier_enquiries")
      .select("id, drug_id, drug_name, quantity, urgency, organisation, partner_id, status, country, created_at")
      .eq("user_id", uid)
      .order("created_at", { ascending: false });
    setEnquiries((data ?? []) as EnquiryRow[]);
    setEnquiriesLoading(false);
  }

  async function removeWatch(id: string) {
    setRemovingId(id);
    await supabase.from("user_watchlists").update({ is_active: false }).eq("id", id);
    setWatchlist(w => w.filter(r => r.id !== id));
    setRemovingId(null);
  }

  async function toggleEmailAlert(row: WatchlistRow) {
    const updated = { ...row.notification_channels, email: !row.notification_channels.email };
    await supabase.from("user_watchlists").update({ notification_channels: updated }).eq("id", row.id);
    setWatchlist(w => w.map(r => r.id === row.id ? { ...r, notification_channels: updated } : r));
  }

  async function signOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push("/");
  }

  async function saveRole(newRole: string) {
    if (!user) return;
    setRoleSaving(true);
    setRoleSaved(false);
    await supabase.from("user_profiles").upsert(
      { user_id: user.id, role: newRole },
      { onConflict: "user_id" },
    );
    setRole(newRole);
    setRoleSaving(false);
    setRoleSaved(true);
    setTimeout(() => setRoleSaved(false), 2000);
  }

  const inputStyle = {
    width: "100%", padding: "10px 12px", borderRadius: 8,
    border: "1px solid var(--app-border)", fontSize: 14,
    fontFamily: "var(--font-inter), sans-serif",
    outline: "none", background: "var(--app-bg)", color: "var(--app-text)",
    boxSizing: "border-box" as const,
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--app-bg)" }}>
        <div style={{ fontSize: 14, color: "var(--app-text-4)" }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={{ background: "var(--app-bg)", minHeight: "100vh", color: "var(--app-text)", fontFamily: "var(--font-inter), sans-serif" }}>
      <style>{`
        @media (max-width: 768px) {
          .account-layout { grid-template-columns: 1fr !important; gap: 0 !important; }
          .account-sidebar { border-right: none !important; border-bottom: 1px solid var(--app-border) !important; padding: 24px 16px !important; }
          .account-main { padding: 24px 16px !important; }
          .account-footer { padding: 24px 16px !important; flex-direction: column !important; gap: 10px !important; text-align: center !important; }
        }
      `}</style>

      <SiteNav />

      {!user ? (
        <NotSignedIn />
      ) : (
        <div className="account-layout" style={{ maxWidth: 900, margin: "0 auto", display: "grid", gridTemplateColumns: "220px 1fr", minHeight: "calc(100vh - 60px)" }}>

          {/* SIDEBAR */}
          <aside className="account-sidebar" style={{
            borderRight: "1px solid var(--app-border)",
            padding: "40px 24px",
            display: "flex", flexDirection: "column", gap: 4,
          }}>
            <div style={{ marginBottom: 24 }}>
              <div style={{
                width: 44, height: 44, borderRadius: "50%",
                background: "var(--teal)", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18, fontWeight: 700, marginBottom: 12,
              }}>
                {(user.email?.[0] ?? "U").toUpperCase()}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--app-text)", marginBottom: 2 }}>
                {user.email}
              </div>
              <div style={{ fontSize: 11, color: "var(--app-text-4)" }}>
                Member since {new Date(user.created_at).toLocaleDateString("en-AU", { month: "short", year: "numeric" })}
              </div>
            </div>

            {(["watchlist", "enquiries", "settings"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  textAlign: "left", padding: "9px 12px", borderRadius: 7,
                  fontSize: 13, fontWeight: activeTab === tab ? 600 : 400,
                  background: activeTab === tab ? "var(--teal-bg)" : "none",
                  color: activeTab === tab ? "var(--teal)" : "var(--app-text-3)",
                  border: "none", cursor: "pointer",
                  fontFamily: "var(--font-inter), sans-serif",
                  textTransform: "capitalize",
                }}
              >
                {tab === "watchlist" ? `Watchlist (${watchlist.length})`
                  : tab === "enquiries" ? `Enquiries (${enquiries.length})`
                  : "Settings"}
              </button>
            ))}

            <div style={{ marginTop: "auto", paddingTop: 32 }}>
              <button
                onClick={signOut}
                disabled={signingOut}
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: 7,
                  fontSize: 13, fontWeight: 500, textAlign: "left",
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--app-text-4)",
                  fontFamily: "var(--font-inter), sans-serif",
                }}
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </aside>

          {/* MAIN */}
          <main className="account-main" style={{ padding: "40px 40px" }}>

            {activeTab === "watchlist" && (
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--app-text)", marginBottom: 6, marginTop: 0, letterSpacing: "-0.02em" }}>
                  Watchlist
                </h2>
                <p style={{ fontSize: 13, color: "var(--app-text-4)", marginBottom: 28, marginTop: 0 }}>
                  You&apos;ll receive email alerts when shortage status changes for watched drugs.
                </p>

                {watchlistLoading && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[1, 2, 3].map(i => (
                      <div key={i} style={{ height: 70, background: "#fff", border: "1px solid var(--app-border)", borderRadius: 10 }} />
                    ))}
                  </div>
                )}

                {!watchlistLoading && watchlist.length === 0 && (
                  <div style={{
                    background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12,
                    padding: "48px 32px", textAlign: "center",
                  }}>
                    <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--app-text-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                      </svg>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "var(--app-text)", marginBottom: 8 }}>No drugs on your watchlist</div>
                    <div style={{ fontSize: 13, color: "var(--app-text-3)", marginBottom: 20 }}>
                      Search for a drug and click &ldquo;Alert me when available&rdquo; to start tracking.
                    </div>
                    <Link href="/search" style={{
                      fontSize: 13, fontWeight: 600, padding: "9px 20px",
                      background: "var(--teal)", color: "#fff", borderRadius: 7, textDecoration: "none",
                    }}>
                      Search drugs →
                    </Link>
                  </div>
                )}

                {!watchlistLoading && watchlist.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {watchlist.map(row => (
                      <div key={row.id} style={{
                        background: "#fff", border: "1px solid var(--app-border)", borderRadius: 10,
                        padding: "16px 18px", display: "flex", alignItems: "center", gap: 16,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Link href={`/drugs/${row.drug_id}`} style={{ textDecoration: "none" }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--app-text)", marginBottom: 2 }}>
                              {row.drugs?.[0]?.generic_name ?? "Unknown drug"}
                            </div>
                          </Link>
                          {row.drugs?.[0]?.brand_names?.[0] && (
                            <div style={{ fontSize: 11, color: "var(--app-text-4)" }}>
                              {row.drugs[0].brand_names.slice(0, 2).join(", ")}
                            </div>
                          )}
                        </div>

                        {/* Email toggle */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                          <span style={{ fontSize: 11, color: "var(--app-text-4)" }}>Email</span>
                          <button
                            onClick={() => toggleEmailAlert(row)}
                            style={{
                              width: 36, height: 20, borderRadius: 10,
                              background: row.notification_channels.email ? "var(--teal)" : "var(--app-border-2)",
                              border: "none", cursor: "pointer", position: "relative",
                              transition: "background 0.15s",
                            }}
                          >
                            <span style={{
                              position: "absolute", top: 2,
                              left: row.notification_channels.email ? 18 : 2,
                              width: 16, height: 16, borderRadius: "50%",
                              background: "#fff", transition: "left 0.15s",
                            }} />
                          </button>
                        </div>

                        <button
                          onClick={() => removeWatch(row.id)}
                          disabled={removingId === row.id}
                          style={{
                            fontSize: 12, color: "var(--app-text-4)", background: "none",
                            border: "none", cursor: "pointer", padding: "4px 8px",
                            borderRadius: 5, flexShrink: 0,
                          }}
                        >
                          {removingId === row.id ? "…" : "Remove"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "enquiries" && (
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--app-text)", marginBottom: 6, marginTop: 0, letterSpacing: "-0.02em" }}>
                  Supplier enquiries
                </h2>
                <p style={{ fontSize: 13, color: "var(--app-text-4)", marginBottom: 28, marginTop: 0 }}>
                  Requests you&apos;ve sent to supplier partners via Mederti.
                </p>

                {enquiriesLoading && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[1, 2].map(i => (
                      <div key={i} style={{ height: 80, background: "#fff", border: "1px solid var(--app-border)", borderRadius: 10 }} />
                    ))}
                  </div>
                )}

                {!enquiriesLoading && enquiries.length === 0 && (
                  <div style={{
                    background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12,
                    padding: "48px 32px", textAlign: "center",
                  }}>
                    <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--app-text-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 3h10l-1 6H3L2 3z" /><circle cx="5" cy="11.5" r=".8" fill="currentColor" stroke="none" /><circle cx="9" cy="11.5" r=".8" fill="currentColor" stroke="none" />
                      </svg>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "var(--app-text)", marginBottom: 8 }}>No enquiries yet</div>
                    <div style={{ fontSize: 13, color: "var(--app-text-3)", marginBottom: 20 }}>
                      Use &ldquo;Find a supplier&rdquo; on any drug page to send an enquiry to a verified partner.
                    </div>
                    <Link href="/search" style={{
                      fontSize: 13, fontWeight: 600, padding: "9px 20px",
                      background: "var(--teal)", color: "#fff", borderRadius: 7, textDecoration: "none",
                    }}>
                      Search drugs →
                    </Link>
                  </div>
                )}

                {!enquiriesLoading && enquiries.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {enquiries.map(row => {
                      const urgencyStyle = row.urgency === "critical"
                        ? { bg: "var(--crit-bg)", color: "var(--crit)", border: "var(--crit-b)" }
                        : row.urgency === "urgent"
                        ? { bg: "var(--high-bg)", color: "var(--high)", border: "var(--high-b)" }
                        : { bg: "var(--app-bg)", color: "var(--app-text-4)", border: "var(--app-border)" };
                      return (
                        <div key={row.id} style={{
                          background: "#fff", border: "1px solid var(--app-border)", borderRadius: 10,
                          padding: "16px 18px",
                        }}>
                          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                            <div style={{ minWidth: 0 }}>
                              {row.drug_id ? (
                                <Link href={`/drugs/${row.drug_id}`} style={{ textDecoration: "none" }}>
                                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--app-text)" }}>{row.drug_name}</div>
                                </Link>
                              ) : (
                                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--app-text)" }}>{row.drug_name}</div>
                              )}
                              <div style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 2 }}>
                                To {PARTNER_NAMES[row.partner_id] ?? row.partner_id} · {row.country}
                              </div>
                            </div>
                            <span style={{
                              fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 4,
                              textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0,
                              background: urgencyStyle.bg, color: urgencyStyle.color,
                              border: `1px solid ${urgencyStyle.border}`,
                            }}>
                              {row.urgency}
                            </span>
                          </div>
                          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--app-text-4)" }}>
                            {row.quantity && <span>Qty: {row.quantity}</span>}
                            {row.organisation && <span>Org: {row.organisation}</span>}
                            <span style={{ marginLeft: "auto", fontFamily: "var(--font-dm-mono), monospace", fontSize: 11 }}>
                              {new Date(row.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === "settings" && (
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--app-text)", marginBottom: 24, marginTop: 0, letterSpacing: "-0.02em" }}>
                  Account settings
                </h2>

                <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
                  {/* Email */}
                  <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, padding: "24px 24px" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--app-text)", marginBottom: 16 }}>Email address</div>
                    <input style={inputStyle} value={user.email ?? ""} readOnly />
                    <div style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 8 }}>
                      To change your email, contact <a href="mailto:hello@mederti.com" style={{ color: "var(--teal)" }}>hello@mederti.com</a>
                    </div>
                  </div>

                  {/* Role selector */}
                  <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, padding: "24px 24px" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--app-text)", marginBottom: 6 }}>Role</div>
                    <div style={{ fontSize: 13, color: "var(--app-text-3)", marginBottom: 16 }}>
                      Your role determines which features and dashboards you can access.
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {ROLE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => saveRole(opt.value)}
                          disabled={roleSaving}
                          style={{
                            padding: "8px 16px", borderRadius: 7,
                            fontSize: 13, fontWeight: role === opt.value ? 600 : 400,
                            background: role === opt.value ? "var(--teal-bg)" : "#fff",
                            color: role === opt.value ? "var(--teal)" : "var(--app-text-3)",
                            border: `1px solid ${role === opt.value ? "var(--teal)" : "var(--app-border)"}`,
                            cursor: roleSaving ? "wait" : "pointer",
                            fontFamily: "var(--font-inter), sans-serif",
                            transition: "all 0.15s",
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {roleSaved && (
                      <div style={{ fontSize: 12, color: "var(--teal)", marginTop: 10, fontWeight: 500 }}>
                        Role updated successfully.
                      </div>
                    )}
                    {role === "supplier" && (
                      <div style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 10 }}>
                        You now have access to the <Link href="/supplier-dashboard" style={{ color: "var(--teal)", fontWeight: 500 }}>Supplier Dashboard</Link>.
                      </div>
                    )}
                  </div>

                  {/* Alert preferences */}
                  <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, padding: "24px 24px" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--app-text)", marginBottom: 6 }}>Alert preferences</div>
                    <div style={{ fontSize: 13, color: "var(--app-text-3)", marginBottom: 16 }}>
                      Manage per-drug email alerts from the Watchlist tab. Global settings coming soon.
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {[
                        ["Status change (active → resolved)", true],
                        ["New shortage declared (matching watchlist)", true],
                        ["Severity escalation (high → critical)", true],
                        ["Weekly shortage digest", false],
                      ].map(([label, enabled]) => (
                        <div key={label as string} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--app-bg-2)" }}>
                          <span style={{ fontSize: 13, color: "var(--app-text-2)" }}>{label}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: enabled ? "var(--teal)" : "var(--app-text-4)", background: enabled ? "var(--teal-bg)" : "var(--app-bg-2)", padding: "2px 8px", borderRadius: 4 }}>
                            {enabled ? "On" : "Off"}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 12 }}>
                      Granular alert controls available on the Pro tier. <Link href="/pricing" style={{ color: "var(--teal)" }}>See pricing →</Link>
                    </div>
                  </div>

                  {/* Danger zone */}
                  <div style={{ background: "#fff", border: "1px solid var(--crit-b)", borderRadius: 12, padding: "24px 24px" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--crit)", marginBottom: 6 }}>Delete account</div>
                    <div style={{ fontSize: 13, color: "var(--app-text-3)", marginBottom: 16, lineHeight: 1.65 }}>
                      Permanently removes your account, watchlist, and all associated data.
                      This cannot be undone.
                    </div>
                    <a href="mailto:hello@mederti.com?subject=Account%20deletion%20request" style={{
                      fontSize: 13, fontWeight: 500, padding: "8px 16px",
                      background: "#fff", border: "1px solid var(--crit-b)", color: "var(--crit)",
                      borderRadius: 7, textDecoration: "none", display: "inline-block",
                    }}>
                      Request account deletion
                    </a>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      )}

      <SiteFooter />
    </div>
  );
}
