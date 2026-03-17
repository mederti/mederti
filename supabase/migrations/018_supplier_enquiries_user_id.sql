-- 018_supplier_enquiries_user_id.sql
-- Link supplier enquiries to authenticated users so they can view their history.

ALTER TABLE supplier_enquiries
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_enquiries_user ON supplier_enquiries(user_id);

-- Allow authenticated users to read their own enquiries
CREATE POLICY "Users can view own enquiries"
  ON supplier_enquiries FOR SELECT
  USING (auth.uid() = user_id);
