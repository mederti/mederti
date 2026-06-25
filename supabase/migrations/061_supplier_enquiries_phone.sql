-- 061_supplier_enquiries_phone.sql
-- Adds an optional contact phone number to supplier enquiries, collected in the
-- drug-page "Find a supplier" drawer so the Mederti sourcing team can call back
-- on urgent requests. The API insert is defensive (retries without this column)
-- so deploying the code ahead of this migration does not break submissions.

ALTER TABLE supplier_enquiries ADD COLUMN IF NOT EXISTS user_phone TEXT;
