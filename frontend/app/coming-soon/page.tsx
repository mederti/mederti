import Link from "next/link";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";
import { Compass } from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ from?: string }>;
}

export default async function ComingSoonPage({ searchParams }: PageProps) {
  const { from } = await searchParams;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--app-bg)" }}>
      <SiteNav />

      <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 20px" }}>
        <div style={{
          width: "100%", maxWidth: 540,
          background: "#fff", border: "1px solid var(--app-border)",
          borderRadius: 14, padding: "40px 44px",
          textAlign: "center",
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: "var(--teal-bg)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            marginBottom: 18,
          }}>
            <Compass size={22} color="var(--teal)" />
          </div>

          <h1 style={{
            fontSize: 24, fontWeight: 700,
            letterSpacing: "-0.02em", color: "var(--app-text)",
            margin: "0 0 10px",
            fontFamily: "var(--font-inter), sans-serif",
          }}>
            Coming soon
          </h1>

          <p style={{
            fontSize: 14.5, color: "var(--app-text-3)",
            lineHeight: 1.6, margin: "0 0 22px",
            fontFamily: "var(--font-inter), sans-serif",
          }}>
            This part of Mederti isn't open to the public yet. We're rolling features out gradually — sign up and we'll let you know when this section is ready.
          </p>

          {from && from !== "/" && (
            <p style={{
              fontSize: 11.5, color: "var(--app-text-4)",
              fontFamily: "var(--font-dm-mono), monospace",
              margin: "0 0 22px",
            }}>
              {from}
            </p>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/" style={{
              padding: "11px 22px",
              background: "var(--teal)", color: "#fff",
              borderRadius: 10, textDecoration: "none",
              fontSize: 13.5, fontWeight: 600,
              fontFamily: "var(--font-inter), sans-serif",
            }}>
              Back to home
            </Link>
            <Link href="/search" style={{
              padding: "11px 22px",
              background: "#fff", color: "var(--app-text-2)",
              border: "1px solid var(--app-border)",
              borderRadius: 10, textDecoration: "none",
              fontSize: 13.5, fontWeight: 500,
              fontFamily: "var(--font-inter), sans-serif",
            }}>
              Search drugs
            </Link>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
