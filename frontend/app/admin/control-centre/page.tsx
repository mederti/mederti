"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shield, LogIn } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import SiteNav from "@/app/components/landing-nav";
import type { ControlCentreData } from "@/lib/admin/control-centre-data";
import ControlCentreDashboard from "./dashboard";

/**
 * /admin/control-centre — CEO roll-up dashboard.
 *
 * Auth model matches the other /admin pages: the page renders a sign-in
 * prompt for anonymous visitors; the real gate is requireAdmin() inside
 * /api/admin/control-centre, which 403s non-admin users.
 */
export default function ControlCentrePage() {
  const supabase = createBrowserClient();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [data, setData] = useState<ControlCentreData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setAuthed(!!user));
  }, [supabase]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/control-centre", { cache: "no-store" });
      if (res.status === 403) {
        setError("Forbidden — admin role required.");
      } else if (!res.ok) {
        setError(`HTTP ${res.status}`);
      } else {
        setData((await res.json()) as ControlCentreData);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authed) void load();
  }, [authed]);

  if (authed === false) {
    return (
      <main style={{ minHeight: "100vh" }}>
        <SiteNav />
        <div style={{ maxWidth: 480, margin: "120px auto", textAlign: "center", padding: "0 20px" }}>
          <Shield size={32} style={{ color: "var(--teal, #0fa676)", margin: "0 auto 16px" }} />
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Admin sign-in required</h1>
          <Link
            href="/login?redirect=/admin/control-centre"
            style={{
              display: "inline-flex", gap: 8, alignItems: "center", padding: "10px 20px",
              background: "var(--teal, #0fa676)", color: "#fff", borderRadius: 8,
              textDecoration: "none", fontWeight: 600,
            }}
          >
            <LogIn size={16} /> Sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f5f7f6" }}>
      <SiteNav />
      {error && (
        <div style={{ maxWidth: 1380, margin: "24px auto 0", padding: "0 24px" }}>
          <div style={{ background: "#fee2e2", color: "#b91c1c", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
            {error}
          </div>
        </div>
      )}
      {!data && !error && (
        <p style={{ textAlign: "center", color: "#86908b", fontSize: 13, marginTop: 80 }}>
          Aggregating live production data…
        </p>
      )}
      {data && <ControlCentreDashboard data={data} loading={loading} onRefresh={() => void load()} />}
    </main>
  );
}
