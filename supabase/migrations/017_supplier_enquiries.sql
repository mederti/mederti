-- 017_supplier_enquiries.sql
-- Stores supplier contact enquiries submitted via the drug page drawer.

CREATE TABLE IF NOT EXISTS supplier_enquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drug_id UUID REFERENCES drugs(id) ON DELETE SET NULL,
  drug_name TEXT NOT NULL,
  quantity TEXT,
  urgency TEXT NOT NULL,
  organisation TEXT,
  message TEXT,
  country TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  user_email TEXT,
  status TEXT DEFAULT 'sent',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_supplier_enquiries_drug ON supplier_enquiries(drug_id);
CREATE INDEX idx_supplier_enquiries_partner ON supplier_enquiries(partner_id);
CREATE INDEX idx_supplier_enquiries_created ON supplier_enquiries(created_at DESC);

-- RLS
ALTER TABLE supplier_enquiries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow service role all" ON supplier_enquiries FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
