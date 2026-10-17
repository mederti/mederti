// Server-only: uses the service-role client.
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { statusLabel, type AlternativeCitation, type AlternativeStatus, type SourcedAlternative, type SourcedAlternativesResult } from "@/lib/alternatives-sources";
export { SOURCE_LABELS, statusLabel } from "@/lib/alternatives-sources";
export type { AlternativeCitation, AlternativeStatus, SourcedAlternative, SourcedAlternativesResult } from "@/lib/alternatives-sources";

// Source-backed alternatives (migration 071). Every alternative carries the
// statements that support it, verbatim and linked. Status comes from the
// verified_alternatives view:
//   regulator_authorised  a currently-valid legal instrument permits the swap
//   verified              >= 2 independent publishers state it
//   single_source         exactly one publisher states it — shown with its
//                         citation, NEVER presented as verified
const STATUS_ORDER: Record<AlternativeStatus, number> = { regulator_authorised: 0, verified: 1, single_source: 2 };

function isMissingRelation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  // 42P01 undefined_table; PGRST205 table not in schema cache.
  return err.code === "42P01" || err.code === "PGRST205" || /does not exist|schema cache/i.test(err.message ?? "");
}

export async function fetchSourcedAlternatives(
  drugId: string,
  opts: { kind?: "same_molecule" | "therapeutic"; limit?: number } = {},
): Promise<SourcedAlternativesResult> {
  const sb = getSupabaseAdmin();
  let q = sb
    .from("verified_alternatives")
    .select("alternative_drug_id,kind,verification_status,publishers,last_checked_at")
    .eq("drug_id", drugId);
  if (opts.kind) q = q.eq("kind", opts.kind);
  const { data: pairs, error } = await q;
  if (isMissingRelation(error)) return { available: false, reason: "Source-verified alternatives are not yet available in this database." };
  if (error) throw error;
  if (!pairs || pairs.length === 0) return { available: true, alternatives: [] };

  const altIds = [...new Set(pairs.map((p) => p.alternative_drug_id as string))];
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: evidence, error: e2 }, { data: drugs, error: e3 }] = await Promise.all([
    sb
      .from("alternative_evidence")
      .select("alternative_drug_id,kind,publisher,source_code,authority_type,source_url,statement,indication,country_code,alternative_product,product_ref,dose_statement,valid_until,licence,retrieved_at")
      .eq("drug_id", drugId)
      .in("alternative_drug_id", altIds)
      // Same "current statements only" rule as the verified_alternatives view.
      .or(`valid_until.is.null,valid_until.gte.${today}`)
      .or(`valid_from.is.null,valid_from.lte.${today}`),
    sb.from("drugs").select("id,generic_name").in("id", altIds),
  ]);
  if (e2) throw e2;
  if (e3) throw e3;
  const names = new Map((drugs ?? []).map((d) => [d.id as string, d.generic_name as string]));

  const alternatives: SourcedAlternative[] = pairs.map((p) => {
    const publishers = (p.publishers ?? []) as string[];
    const status = p.verification_status as AlternativeStatus;
    return {
      alternative_drug_id: p.alternative_drug_id,
      name: names.get(p.alternative_drug_id) ?? "Unknown",
      kind: p.kind,
      status,
      status_label: statusLabel(status, publishers),
      publishers,
      last_checked_at: p.last_checked_at,
      citations: (evidence ?? [])
        .filter((e) => e.alternative_drug_id === p.alternative_drug_id && e.kind === p.kind)
        .map(({ alternative_drug_id: _a, kind: _k, ...c }) => ({ ...c, indication: c.indication || null }) as AlternativeCitation),
    };
  });
  alternatives.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.publishers.length - a.publishers.length || a.name.localeCompare(b.name));
  return { available: true, alternatives: opts.limit ? alternatives.slice(0, opts.limit) : alternatives };
}
