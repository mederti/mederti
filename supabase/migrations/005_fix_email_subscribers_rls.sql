-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 005 — Fix email_subscribers RLS
-- The original policy used USING (true) which exposed all emails to anon users.
-- Corrected to service_role only — inserts happen via the Next.js API route
-- which authenticates with the service_role key.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the overly-permissive policy
DROP POLICY IF EXISTS "service_role_all" ON public.email_subscribers;

-- Replace with service_role-only access
CREATE POLICY "email_subscribers: service_role only"
    ON public.email_subscribers
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
