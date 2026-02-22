"""
Supabase client singleton.

Reads credentials from environment variables (loaded from .env by the
caller or by the process environment in production):

    SUPABASE_URL               — e.g. https://xxxx.supabase.co
    SUPABASE_SERVICE_ROLE_KEY  — service-role JWT (bypasses RLS)

The service-role key is required by scrapers so they can write to
raw_scrapes, shortage_events, drugs, etc. without triggering RLS.
Never expose this key client-side.
"""

import os
from functools import lru_cache

from supabase import Client, create_client


@lru_cache(maxsize=1)
def get_supabase_client() -> Client:
    """
    Returns a cached Supabase client authenticated with the service-role key.
    The client is instantiated once per process and reused.

    Raises:
        EnvironmentError: if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY are missing.
    """
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()

    if not url or not key:
        raise EnvironmentError(
            "Missing required environment variables.\n"
            "  SUPABASE_URL              — your Supabase project URL\n"
            "  SUPABASE_SERVICE_ROLE_KEY — service-role JWT (Settings → API)\n"
            "Copy .env.example → .env and fill in both values."
        )

    return create_client(url, key)
