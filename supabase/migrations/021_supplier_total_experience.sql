-- ============================================================================
-- Migration 021: Total Supplier Experience
-- ============================================================================
-- Adds the full lifecycle support: quotes pipeline, analytics, verification,
-- bulk uploads, slug-based public profiles.
-- ============================================================================

-- ── 1. Add slug + onboarding state + analytics counters to supplier_profiles ─
ALTER TABLE supplier_profiles
  ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS onboarded BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected')),
  ADD COLUMN IF NOT EXISTS verification_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS year_founded INTEGER,
  ADD COLUMN IF NOT EXISTS specialties TEXT[] DEFAULT '{}';

-- Backfill slug for existing rows (lowercase, hyphenated company name)
UPDATE supplier_profiles
SET slug = LOWER(REGEXP_REPLACE(company_name, '[^a-zA-Z0-9]+', '-', 'g'))
WHERE slug IS NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_profiles_slug ON supplier_profiles (slug);
CREATE INDEX IF NOT EXISTS idx_supplier_profiles_verification ON supplier_profiles (verification_status);

-- ── 2. Extend supplier_quotes with rich pipeline fields ────────────────────
ALTER TABLE supplier_quotes
  ADD COLUMN IF NOT EXISTS pipeline_stage TEXT DEFAULT 'submitted'
    CHECK (pipeline_stage IN ('draft', 'submitted', 'viewed', 'negotiating', 'won', 'lost', 'expired')),
  ADD COLUMN IF NOT EXISTS valid_until DATE,
  ADD COLUMN IF NOT EXISTS minimum_order_quantity TEXT,
  ADD COLUMN IF NOT EXISTS shipping_terms TEXT,
  ADD COLUMN IF NOT EXISTS payment_terms TEXT,
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS viewed_by_buyer_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS won_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lost_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_supplier_quotes_pipeline ON supplier_quotes (pipeline_stage);

-- ── 3. supplier_documents (verification & trust) ───────────────────────────
CREATE TABLE IF NOT EXISTS supplier_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES supplier_profiles(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL
    CHECK (document_type IN ('wholesale_license', 'gmp_certificate', 'iso_certification',
                             'business_registration', 'tax_certificate', 'other')),
  document_name TEXT NOT NULL,
  file_url TEXT,
  expires_on DATE,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_documents_supplier ON supplier_documents (supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_documents_status ON supplier_documents (status) WHERE status = 'pending';

-- ── 4. supplier_analytics_events (lightweight tracking) ─────────────────────
CREATE TABLE IF NOT EXISTS supplier_analytics_events (
  id BIGSERIAL PRIMARY KEY,
  supplier_id UUID NOT NULL REFERENCES supplier_profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('profile_view', 'inventory_view', 'contact_click', 'enquiry_received', 'quote_submitted', 'quote_won')),
  drug_id UUID REFERENCES drugs(id) ON DELETE SET NULL,
  buyer_country TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_analytics_supplier_time
  ON supplier_analytics_events (supplier_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_analytics_event_type
  ON supplier_analytics_events (event_type);

-- ── 5. supplier_notifications (in-app + email queue) ───────────────────────
CREATE TABLE IF NOT EXISTS supplier_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES supplier_profiles(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL
    CHECK (notification_type IN ('new_enquiry', 'quote_viewed', 'quote_won', 'quote_lost',
                                 'verification_approved', 'verification_rejected', 'inventory_expiring')),
  title TEXT NOT NULL,
  body TEXT,
  link_url TEXT,
  read BOOLEAN DEFAULT FALSE,
  email_sent BOOLEAN DEFAULT FALSE,
  related_enquiry_id UUID REFERENCES supplier_enquiries(id) ON DELETE CASCADE,
  related_quote_id UUID REFERENCES supplier_quotes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_notifications_supplier_unread
  ON supplier_notifications (supplier_id, read) WHERE read = FALSE;

-- ── RLS Policies ───────────────────────────────────────────────────────────
ALTER TABLE supplier_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_notifications ENABLE ROW LEVEL SECURITY;

-- supplier_documents: only owner reads/writes; service_role full
DROP POLICY IF EXISTS "documents_owner_manage" ON supplier_documents;
CREATE POLICY "documents_owner_manage" ON supplier_documents
  FOR ALL USING (
    supplier_id IN (SELECT id FROM supplier_profiles WHERE user_id = auth.uid())
  );

-- supplier_analytics_events: only owner reads; service_role writes
DROP POLICY IF EXISTS "analytics_owner_read" ON supplier_analytics_events;
CREATE POLICY "analytics_owner_read" ON supplier_analytics_events
  FOR SELECT USING (
    supplier_id IN (SELECT id FROM supplier_profiles WHERE user_id = auth.uid())
  );

-- supplier_notifications: only owner reads/marks-read; service_role writes
DROP POLICY IF EXISTS "notifications_owner_manage" ON supplier_notifications;
CREATE POLICY "notifications_owner_manage" ON supplier_notifications
  FOR ALL USING (
    supplier_id IN (SELECT id FROM supplier_profiles WHERE user_id = auth.uid())
  );

COMMENT ON TABLE supplier_documents IS 'Verification documents (license, GMP cert, etc.)';
COMMENT ON TABLE supplier_analytics_events IS 'Lightweight tracking for supplier dashboard analytics';
COMMENT ON TABLE supplier_notifications IS 'In-app + email notification queue for suppliers';
