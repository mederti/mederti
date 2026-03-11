"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, LogIn, Bookmark, Settings } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";

const ICON = { width: 15, height: 15, strokeWidth: 1.5 } as const;

export default function AlertsPage() {
  const [authed, setAuthed]   = useState<boolean | null>(null);
  const [email, setEmail]     = useState<string | null>(null);
  const supabase = createBrowserClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setAuthed(true);
        setEmail(session.user.email ?? null);
      } else {
        setAuthed(false);
      }
    });
  }, [supabase.auth]);

  return (
    <div style={{ background: "var(--app-bg)", minHeight: "100vh", color: "var(--app-text)" }}>

      {/* Nav */}
      <SiteNav />

      {/* Hero */}
      <div style={{ background: "#fff", borderBottom: "1px solid var(--app-border)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <Bell style={{ width: 20, height: 20, color: "var(--teal)" }} strokeWidth={1.8} />
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--app-text)", margin: 0 }}>Alerts</h1>
          </div>
          <p style={{ fontSize: 14, color: "var(--app-text-3)", margin: 0 }}>
            Get notified the moment shortage status changes for drugs you watch.
          </p>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 48px" }}>

        {/* Loading */}
        {authed === null && (
          <div style={{ padding: "48px 0", textAlign: "center" }}>
            <div style={{
              width: 24, height: 24, borderRadius: "50%",
              border: "2px solid var(--teal)", borderTopColor: "transparent",
              animation: "spin 0.7s linear infinite",
              margin: "0 auto",
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Not signed in */}
        {authed === false && (
          <div style={{
            background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12,
            padding: "64px 24px", textAlign: "center", maxWidth: 460, margin: "0 auto",
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: "50%",
              background: "var(--teal-bg)", border: "1px solid var(--teal-b)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 18px",
            }}>
              <Bell style={{ width: 22, height: 22 }} color="var(--teal)" strokeWidth={1.6} />
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--app-text)", margin: "0 0 8px" }}>
              Sign in to manage alerts
            </h2>
            <p style={{ fontSize: 14, color: "var(--app-text-3)", marginBottom: 24, lineHeight: 1.6 }}>
              Create an account or sign in to receive email notifications when shortage status changes for drugs on your watchlist.
            </p>
            <Link href="/login?next=/alerts" style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "10px 22px", borderRadius: 8,
              background: "var(--teal)", color: "#fff",
              fontSize: 14, fontWeight: 600, textDecoration: "none",
            }}>
              <LogIn {...ICON} />
              Sign in
            </Link>
            <div style={{ marginTop: 14 }}>
              <Link href="/signup" style={{ fontSize: 13, color: "var(--app-text-3)", textDecoration: "none" }}>
                No account? <span style={{ color: "var(--teal)", fontWeight: 500 }}>Create one free</span>
              </Link>
            </div>
          </div>
        )}

        {/* Signed in */}
        {authed === true && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 680 }}>

            {/* Section header */}
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--app-text)", margin: "0 0 4px" }}>
                Your Alerts
              </h2>
              {email && (
                <p style={{ fontSize: 13, color: "var(--app-text-4)", margin: 0 }}>
                  Notifications sent to <span style={{ color: "var(--app-text-3)", fontWeight: 500 }}>{email}</span>
                </p>
              )}
            </div>

            {/* Info box */}
            <div style={{
              background: "var(--teal-bg)", border: "1px solid var(--teal-b)", borderRadius: 10,
              padding: "16px 20px", display: "flex", gap: 14, alignItems: "flex-start",
            }}>
              <Bell style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1 }} color="var(--teal)" strokeWidth={1.6} />
              <div>
                <p style={{ fontSize: 13, color: "var(--app-text-2)", margin: "0 0 4px", fontWeight: 500 }}>
                  How alerts work
                </p>
                <p style={{ fontSize: 13, color: "var(--app-text-3)", margin: 0, lineHeight: 1.6 }}>
                  You will receive email alerts when shortages change status for drugs on your watchlist — including new shortages, severity escalations, and resolutions.
                </p>
              </div>
            </div>

            {/* Action cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Link href="/watchlist" style={{
                display: "flex", alignItems: "flex-start", gap: 14,
                padding: "18px 20px",
                background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12,
                textDecoration: "none", transition: "border-color 0.12s",
              }}
                className="alert-action-card"
              >
                <div style={{
                  width: 38, height: 38, borderRadius: 9, flexShrink: 0,
                  background: "var(--ind-bg)", border: "1px solid var(--ind-b)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Bookmark style={{ width: 17, height: 17 }} color="var(--indigo)" strokeWidth={1.7} />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--app-text)", marginBottom: 4 }}>
                    Manage watchlist
                  </div>
                  <div style={{ fontSize: 12, color: "var(--app-text-4)", lineHeight: 1.5 }}>
                    Add or remove drugs you want to monitor for shortages.
                  </div>
                </div>
              </Link>

              <Link href="/account" style={{
                display: "flex", alignItems: "flex-start", gap: 14,
                padding: "18px 20px",
                background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12,
                textDecoration: "none", transition: "border-color 0.12s",
              }}
                className="alert-action-card"
              >
                <div style={{
                  width: 38, height: 38, borderRadius: 9, flexShrink: 0,
                  background: "var(--app-bg-2)", border: "1px solid var(--app-border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Settings style={{ width: 17, height: 17 }} color="var(--app-text-3)" strokeWidth={1.7} />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--app-text)", marginBottom: 4 }}>
                    Notification preferences
                  </div>
                  <div style={{ fontSize: 12, color: "var(--app-text-4)", lineHeight: 1.5 }}>
                    Choose which severity levels trigger alerts and your delivery method.
                  </div>
                </div>
              </Link>
            </div>

          </div>
        )}
      </div>

      <SiteFooter />

      <style>{`
        .alert-action-card:hover { border-color: var(--app-border-2) !important; }
      `}</style>
    </div>
  );
}
