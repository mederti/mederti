-- 015_supplier_dashboard.sql
-- Adds user_profiles (role-based access) and supplier_portfolios (drug portfolio tracking)

-- ── user_profiles ──────────────────────────────────────────────────────
CREATE TABLE user_profiles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL UNIQUE,
    role        TEXT NOT NULL DEFAULT 'default'
                CHECK (role IN ('pharmacist', 'hospital', 'supplier', 'government', 'default')),
    company_name TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX idx_user_profiles_role ON user_profiles(role);

CREATE TRIGGER trg_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_profiles: users manage own row"
    ON user_profiles FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_profiles: service_role full access"
    ON user_profiles FOR ALL
    USING (auth.role() = 'service_role');

-- ── supplier_portfolios ────────────────────────────────────────────────
CREATE TABLE supplier_portfolios (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL,
    drug_id    UUID NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
    notes      TEXT,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_supplier_portfolio UNIQUE (user_id, drug_id)
);

CREATE INDEX idx_supplier_portfolios_user_id ON supplier_portfolios(user_id);
CREATE INDEX idx_supplier_portfolios_drug_id ON supplier_portfolios(drug_id);

ALTER TABLE supplier_portfolios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "supplier_portfolios: users manage own rows"
    ON supplier_portfolios FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "supplier_portfolios: service_role full access"
    ON supplier_portfolios FOR ALL
    USING (auth.role() = 'service_role');
