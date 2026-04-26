-- ============================================================================
-- Migration 020: Supplier Marketplace
-- ============================================================================
-- Adds three tables to power the wholesaler/supplier revenue experience:
--   1. supplier_profiles    — registered supplier organisations (verified, tier)
--   2. supplier_inventory   — stock available for sale, shown on drug pages
--   3. supplier_quotes      — supplier responses to buyer enquiries
--
-- Revenue mechanics:
--   - Free suppliers see basic enquiries
--   - Pro suppliers ($800/mo) see full enquiry inbox + can broadcast inventory
--   - Verified suppliers appear first on drug pages
-- ============================================================================

-- ── 1. supplier_profiles ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  website TEXT,
  countries_served TEXT[] DEFAULT '{}',
  description TEXT,
  verified BOOLEAN DEFAULT FALSE,
  tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_profiles_countries
  ON supplier_profiles USING GIN (countries_served);
CREATE INDEX IF NOT EXISTS idx_supplier_profiles_tier
  ON supplier_profiles (tier) WHERE tier <> 'free';

-- ── 2. supplier_inventory ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES supplier_profiles(id) ON DELETE CASCADE,
  drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
  countries TEXT[] DEFAULT '{}',
  quantity_available TEXT,
  unit_price NUMERIC,
  currency TEXT DEFAULT 'AUD',
  pack_size TEXT,
  notes TEXT,
  available_until DATE,
  status TEXT DEFAULT 'available' CHECK (status IN ('available', 'limited', 'depleted')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(supplier_id, drug_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_inventory_drug
  ON supplier_inventory (drug_id) WHERE status <> 'depleted';
CREATE INDEX IF NOT EXISTS idx_supplier_inventory_supplier
  ON supplier_inventory (supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_inventory_countries
  ON supplier_inventory USING GIN (countries);

-- ── 3. supplier_quotes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id UUID NOT NULL REFERENCES supplier_enquiries(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES supplier_profiles(id) ON DELETE CASCADE,
  quote_amount NUMERIC,
  currency TEXT DEFAULT 'AUD',
  available_quantity TEXT,
  delivery_eta TEXT,
  notes TEXT,
  status TEXT DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'accepted', 'declined', 'expired')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_quotes_enquiry
  ON supplier_quotes (enquiry_id);
CREATE INDEX IF NOT EXISTS idx_supplier_quotes_supplier
  ON supplier_quotes (supplier_id);

-- ── RLS Policies ───────────────────────────────────────────────────────────
ALTER TABLE supplier_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_quotes ENABLE ROW LEVEL SECURITY;

-- supplier_profiles: anyone can SELECT (public profiles), only owner can INSERT/UPDATE
DROP POLICY IF EXISTS "supplier_profiles_select" ON supplier_profiles;
CREATE POLICY "supplier_profiles_select" ON supplier_profiles
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "supplier_profiles_insert_own" ON supplier_profiles;
CREATE POLICY "supplier_profiles_insert_own" ON supplier_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "supplier_profiles_update_own" ON supplier_profiles;
CREATE POLICY "supplier_profiles_update_own" ON supplier_profiles
  FOR UPDATE USING (auth.uid() = user_id);

-- supplier_inventory: anyone can SELECT (public listings), only owner can manage
DROP POLICY IF EXISTS "supplier_inventory_select" ON supplier_inventory;
CREATE POLICY "supplier_inventory_select" ON supplier_inventory
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "supplier_inventory_manage_own" ON supplier_inventory;
CREATE POLICY "supplier_inventory_manage_own" ON supplier_inventory
  FOR ALL USING (
    supplier_id IN (SELECT id FROM supplier_profiles WHERE user_id = auth.uid())
  );

-- supplier_quotes: only the supplier who submitted, the enquirer, and service_role can see
DROP POLICY IF EXISTS "supplier_quotes_supplier_view" ON supplier_quotes;
CREATE POLICY "supplier_quotes_supplier_view" ON supplier_quotes
  FOR SELECT USING (
    supplier_id IN (SELECT id FROM supplier_profiles WHERE user_id = auth.uid())
  );

-- ── Auto-update updated_at trigger ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_supplier_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS supplier_profiles_updated_at ON supplier_profiles;
CREATE TRIGGER supplier_profiles_updated_at
  BEFORE UPDATE ON supplier_profiles
  FOR EACH ROW EXECUTE FUNCTION update_supplier_updated_at();

DROP TRIGGER IF EXISTS supplier_inventory_updated_at ON supplier_inventory;
CREATE TRIGGER supplier_inventory_updated_at
  BEFORE UPDATE ON supplier_inventory
  FOR EACH ROW EXECUTE FUNCTION update_supplier_updated_at();

DROP TRIGGER IF EXISTS supplier_quotes_updated_at ON supplier_quotes;
CREATE TRIGGER supplier_quotes_updated_at
  BEFORE UPDATE ON supplier_quotes
  FOR EACH ROW EXECUTE FUNCTION update_supplier_updated_at();

COMMENT ON TABLE supplier_profiles IS 'Registered wholesaler/supplier organisations';
COMMENT ON TABLE supplier_inventory IS 'Drugs that suppliers have in stock (shown on drug pages)';
COMMENT ON TABLE supplier_quotes IS 'Supplier responses to buyer enquiries';
