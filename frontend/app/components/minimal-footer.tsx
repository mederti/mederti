import Link from "next/link";

/* Slim, light footer — mirrors the landing page's `home-foot` row.
   Replaces the heavy dark SiteFooter on the simple public pages
   (about / privacy / contact / terms). */
export default function MinimalFooter() {
  return (
    <footer
      style={{
        maxWidth: 1040,
        margin: "64px auto 0",
        padding: "30px 24px 40px",
        borderTop: "1px solid var(--app-border)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 12,
        fontSize: 12,
        color: "var(--app-text-4)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-black.png" alt="Mederti" style={{ height: 18 }} />
      <div style={{ display: "flex", gap: 18 }}>
        <Link href="/about" style={{ color: "inherit", textDecoration: "none" }}>About</Link>
        <Link href="/privacy" style={{ color: "inherit", textDecoration: "none" }}>Privacy</Link>
        <Link href="/contact" style={{ color: "inherit", textDecoration: "none" }}>Contact</Link>
      </div>
      <span>© 2026 Mederti Pty Ltd · Melbourne, Australia</span>
    </footer>
  );
}
