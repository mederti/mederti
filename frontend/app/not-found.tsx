import Link from "next/link";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";

export default function NotFound() {
  return (
    <div style={{ background: "var(--app-bg)", minHeight: "100vh", color: "var(--app-text)" }}>
      <SiteNav />
      <div style={{
        maxWidth: 520, margin: "0 auto",
        padding: "100px 24px 80px",
        textAlign: "center",
      }}>
        <div style={{
          fontSize: 64, fontWeight: 700,
          color: "var(--app-text-4)",
          letterSpacing: "-0.03em",
          lineHeight: 1,
          marginBottom: 12,
          fontFamily: "var(--font-dm-mono), monospace",
        }}>
          404
        </div>
        <h1 style={{
          fontSize: 22, fontWeight: 700,
          color: "var(--app-text)",
          margin: "0 0 8px",
        }}>
          Page not found
        </h1>
        <p style={{
          fontSize: 15, color: "var(--app-text-3)",
          lineHeight: 1.6, margin: "0 0 28px",
        }}>
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <Link href="/" style={{
            display: "inline-flex", alignItems: "center",
            padding: "10px 22px", borderRadius: 8,
            fontSize: 14, fontWeight: 600,
            color: "#fff", background: "var(--teal)",
            textDecoration: "none",
            transition: "opacity 0.15s",
          }}>
            Go home
          </Link>
          <Link href="/search" style={{
            display: "inline-flex", alignItems: "center",
            padding: "10px 22px", borderRadius: 8,
            fontSize: 14, fontWeight: 500,
            color: "var(--app-text-2)",
            background: "#fff",
            border: "1px solid var(--app-border)",
            textDecoration: "none",
          }}>
            Search drugs
          </Link>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
