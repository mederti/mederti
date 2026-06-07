-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 053 — Fuzzy "Did you mean…" suggestion RPC
--
-- Powers Google-style typo correction on /search. When a query matches no
-- drug (e.g. "cefalaxin"), the search route calls this function to find the
-- closest canonical generic name by pg_trgm similarity ("cefalexin") and
-- auto-loads results for it, with a "Search instead for …" revert affordance.
--
-- pg_trgm is already enabled (migration 001/011) and drugs.generic_name has a
-- trigram GIN index (migration 038), so the `%` operator below is index-backed
-- and cheap. This function only runs on the zero-result path, never on the
-- common case.
--
-- min_score gates suggestion quality: we only auto-correct when we're fairly
-- confident. 0.4 keeps "cefalaxin"→"cefalexin" (one-char typo) while rejecting
-- distant noise. Tune via the parameter without a redeploy.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.search_suggestion(
  q           text,
  min_score   real DEFAULT 0.4,
  max_results int  DEFAULT 1
)
RETURNS TABLE(name text, score real)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT generic_name AS name,
         similarity(generic_name, q) AS score
  FROM drugs
  WHERE generic_name % q                       -- trigram index, prunes candidates
    AND lower(generic_name) <> lower(q)         -- never suggest the query itself
    AND similarity(generic_name, q) >= min_score
  ORDER BY similarity(generic_name, q) DESC,
           length(generic_name) ASC             -- prefer the tighter canonical name
  LIMIT GREATEST(max_results, 1);
$$;

COMMENT ON FUNCTION public.search_suggestion(text, real, int) IS
  'Closest canonical drugs.generic_name to q by pg_trgm similarity (>= min_score). Powers /search "Did you mean" auto-correct. Migration 053.';

-- Service role drives the public search route; authenticated users may call it
-- via the same path. Anon PostgREST access stays revoked (migration 047).
GRANT EXECUTE ON FUNCTION public.search_suggestion(text, real, int)
  TO service_role, authenticated;
