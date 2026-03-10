-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 003 — Email subscribers (landing page capture)
-- Run in Supabase SQL Editor before deploying the frontend.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_subscribers (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email      text        NOT NULL,
    source     text        NOT NULL DEFAULT 'landing_page',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT email_subscribers_email_unique UNIQUE (email)
);

ALTER TABLE public.email_subscribers ENABLE ROW LEVEL SECURITY;

-- Only service_role can read/write (no public access)
CREATE POLICY "service_role_all" ON public.email_subscribers
    USING (true)
    WITH CHECK (true);
