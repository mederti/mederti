-- Migration 016: Add structured fields to shortage_events
-- Fixes: TGA availability/management_action buried in notes TEXT
-- Root cause: _infer_severity() ignores availability field entirely

ALTER TABLE shortage_events
  ADD COLUMN IF NOT EXISTS availability_status TEXT,
  ADD COLUMN IF NOT EXISTS management_action TEXT,
  ADD COLUMN IF NOT EXISTS product_registration_id TEXT;

-- Index for ARTG/NDA lookup
CREATE INDEX IF NOT EXISTS idx_shortage_events_product_reg_id
  ON shortage_events(product_registration_id);

-- Index for availability filtering
CREATE INDEX IF NOT EXISTS idx_shortage_events_availability
  ON shortage_events(availability_status);

COMMENT ON COLUMN shortage_events.availability_status IS
  'Structured availability from source: available, unavailable, limited, sourcing';
COMMENT ON COLUMN shortage_events.management_action IS
  'Sponsor/regulator guidance text, e.g. TGA management action field';
COMMENT ON COLUMN shortage_events.product_registration_id IS
  'Country-specific product registration number: ARTG (AU), NDA (US), DIN (CA), PL (UK)';
