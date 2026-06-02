import Link from "next/link";

/**
 * Persistent clinical-safety disclaimer for health-professional surfaces.
 *
 * Required on any view that presents shortage status or substitution
 * information: Mederti is a reference aggregator, NOT clinical advice, and the
 * underlying regulator data can be incomplete or delayed. Substitution and
 * supply decisions must be confirmed against the primary source, the prescriber,
 * and current clinical references before acting.
 */
export default function ClinicalDisclaimer({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <div
      role="note"
      aria-label="Clinical disclaimer"
      style={{
        background: "var(--app-bg-2, #f8fafc)",
        border: "1px solid var(--app-border, #e2e8f0)",
        borderRadius: 10,
        padding: compact ? "10px 12px" : "12px 16px",
        fontSize: compact ? 11 : 12,
        lineHeight: 1.55,
        color: "var(--app-text-3, #475569)",
      }}
    >
      <strong style={{ color: "var(--app-text, #0f172a)", fontWeight: 600 }}>
        For health-professional reference only.
      </strong>{" "}
      Mederti aggregates shortage and substitution information from official
      regulatory sources. It is <strong>not clinical advice</strong> and data may
      be incomplete or delayed. Confirm any substitution or supply decision
      against the primary regulator source, the prescriber, and current clinical
      references (e.g.&nbsp;AMH) before acting.{" "}
      <Link href="/terms" style={{ color: "var(--teal, #0d9488)", textDecoration: "underline" }}>
        Terms
      </Link>
      .
    </div>
  );
}
