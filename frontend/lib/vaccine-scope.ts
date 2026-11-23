// Which shortage notices belong to a drug page.
//
// Normally: the notices filed on that drugs row (drug_id). Vaccines are the
// exception: the scrapers' first-word fallback files Italian "Vaccino…",
// Romanian "Vaccin…" and Latvian "Vaccinum…" notices on whichever vaccine
// row starts that way (Nov 2026: 69 of 213 live vaccine notices sat on
// another vaccine's row). Each notice is typed from its own regulator record
// (shortage_events.vaccine_type, migration 082), so a typed vaccine reads
// the notices that name it — wherever they were filed — plus its own row's
// untyped notices. Server-side only (service-role client).

const UUID = /^[0-9a-f-]{36}$/i;

/** drugs.vaccine_type for this row, or null (not a typed vaccine / column missing). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function vaccineKeyFor(sb: any, drugId: string): Promise<string | null> {
  if (!UUID.test(drugId)) return null;
  try {
    const { data, error } = await sb.from("drugs").select("vaccine_type").eq("id", drugId).maybeSingle();
    if (error) return null;
    return (data?.vaccine_type as string | null) ?? null;
  } catch {
    return null;
  }
}

/** Scope a shortage_events query to the notices that belong to this drug page. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scopeShortages<Q extends { eq: any; or: any }>(q: Q, drugId: string, vaccineKey: string | null): Q {
  // drugId goes into a PostgREST filter string: only ever a bare UUID, and
  // vaccine keys are our own slugs ([a-z0-9-]).
  if (vaccineKey && UUID.test(drugId) && /^[a-z0-9-]+$/.test(vaccineKey)) {
    return q.or(`vaccine_type.eq.${vaccineKey},and(drug_id.eq.${drugId},vaccine_type.is.null)`);
  }
  return q.eq("drug_id", drugId);
}
