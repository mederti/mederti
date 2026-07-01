/**
 * Single source of truth for user_profiles.role values.
 *
 * Must stay in lockstep with the DB CHECK constraint in
 * supabase/migrations/025_user_profile_onboarding.sql. Any value accepted by
 * the API but rejected by the constraint causes a silent upsert failure; any
 * value the DB allows but the API rejects gets silently dropped (the OAuth
 * role-drop bug this list fixes).
 */
export const VALID_PROFILE_ROLES = [
  // Current onboarding roles
  "hospital_pharmacist",
  "community_pharmacist",
  "hospital_procurement",
  "wholesaler",
  "manufacturer",
  "government",
  "researcher",
  "patient",
  // Legacy values kept for back-compat with rows already in the table
  "pharmacist",
  "hospital",
  "supplier",
  "default",
  "other",
] as const;

export type ProfileRole = (typeof VALID_PROFILE_ROLES)[number];

export function isValidProfileRole(role: unknown): role is ProfileRole {
  return typeof role === "string" && (VALID_PROFILE_ROLES as readonly string[]).includes(role);
}
