-- 082_shortage_event_vaccine_type.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- shortage_events.vaccine_type — the vaccine a regulator notice itself names,
-- typed from its own raw_data, independent of the drugs row it is filed on.
--
-- Why event level: the scrapers' first-word fallback files any notice whose
-- name starts "Vaccino…", "Vaccin…" or "Vaccinum…" on whichever drugs row
-- starts that way. On 2026-11-23, 69 of 213 live vaccine notices sat on
-- another vaccine's record (the Italian "Hib" record held Vaxigrip, Fluenz,
-- Nimenrix, Verorab …; the Latvian "Hepatitis A" record held flu, HPV,
-- hexavalent …) and a Belgian botulinum-toxin notice sat on a DTaP-IPV record.
-- Re-pointing rows would be undone by the next scrape (same fallback), so
-- vaccine pages read notices by this column instead.
--
-- Values: a key from backend/utils/vaccine_types.py ("flu", "dtap-ipv" …),
-- 'not-a-vaccine' when the notice carries only non-J07 ATC codes, or NULL
-- when the notice cannot be typed. Set daily by classify_vaccines.py.
--
-- Additive and idempotent; safe to re-run. ADD COLUMN without a default is
-- a catalogue-only change (no table rewrite).
--
-- APPLIED TO PRODUCTION 2026-11-23 via `supabase db query --linked -f`;
-- classify_vaccines --execute typed 533 of 551 notices on vaccine records.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE shortage_events ADD COLUMN IF NOT EXISTS vaccine_type text;

COMMENT ON COLUMN shortage_events.vaccine_type IS
  'Vaccine type named by this notice''s own regulator record (not its drug row); not-a-vaccine; or NULL. See backend/utils/vaccine_types.py.';

CREATE INDEX IF NOT EXISTS idx_shortage_events_vaccine_type
  ON shortage_events (vaccine_type) WHERE vaccine_type IS NOT NULL;
