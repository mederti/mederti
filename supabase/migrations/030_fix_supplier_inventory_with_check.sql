-- Migration 030: Fix supplier_inventory RLS — add WITH CHECK clause
--
-- The existing "supplier_inventory_manage_own" policy only has a USING clause.
-- Without WITH CHECK:
--   • INSERT: the new row's supplier_id is never validated — a supplier could
--     insert a row referencing a different supplier's profile.
--   • UPDATE: the new-row state after an update is not validated — a supplier
--     could change supplier_id to another supplier they don't own.
--
-- This migration adds the matching WITH CHECK so that both reads AND writes
-- are constrained to the authenticated user's own supplier_profile.

DROP POLICY IF EXISTS "supplier_inventory_manage_own" ON supplier_inventory;

CREATE POLICY "supplier_inventory_manage_own" ON supplier_inventory
  FOR ALL
  USING (
    supplier_id IN (SELECT id FROM supplier_profiles WHERE user_id = auth.uid())
  )
  WITH CHECK (
    supplier_id IN (SELECT id FROM supplier_profiles WHERE user_id = auth.uid())
  );
