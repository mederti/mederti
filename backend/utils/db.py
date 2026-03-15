"""
Supabase client — dual mode.

In production (Railway/FastAPI), the supabase-py SDK hangs due to
httpx event-loop conflicts with asyncio. We provide a lightweight
PostgREST wrapper using raw httpx instead.

For scrapers (sync scripts), the SDK still works fine, so we keep
it available as a fallback.

Reads credentials from environment variables:
    SUPABASE_URL               — e.g. https://xxxx.supabase.co
    SUPABASE_SERVICE_ROLE_KEY  — service-role JWT (bypasses RLS)
"""

import os
from functools import lru_cache
from typing import Any, Dict, List, Optional

import httpx


class SupabaseTable:
    """Minimal PostgREST query builder mimicking supabase-py's interface."""

    def __init__(self, url: str, key: str, table: str):
        self._url = f"{url}/rest/v1/{table}"
        self._headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        self._params: Dict[str, str] = {}
        self._method = "GET"
        self._body: Any = None
        self._count_mode: Optional[str] = None
        self._single_mode: bool = False

    def select(self, columns: str = "*", count: Optional[str] = None) -> "SupabaseTable":
        self._params["select"] = columns
        if count:
            self._count_mode = count
            self._headers["Prefer"] = f"count={count}"
        return self

    def insert(self, data: Any, upsert: bool = False) -> "SupabaseTable":
        self._method = "POST"
        self._body = data
        if upsert:
            self._headers["Prefer"] = "resolution=merge-duplicates,return=representation"
        return self

    def upsert(self, data: Any, on_conflict: Optional[str] = None) -> "SupabaseTable":
        self.insert(data, upsert=True)
        if on_conflict:
            self._params["on_conflict"] = on_conflict
        return self

    def single(self) -> "SupabaseTable":
        """Request a single object instead of an array (PostgREST singular response)."""
        self._single_mode = True
        self._headers["Accept"] = "application/vnd.pgrst.object+json"
        return self

    def update(self, data: Any) -> "SupabaseTable":
        self._method = "PATCH"
        self._body = data
        return self

    def delete(self) -> "SupabaseTable":
        self._method = "DELETE"
        return self

    def eq(self, column: str, value: Any) -> "SupabaseTable":
        self._params[column] = f"eq.{value}"
        return self

    def neq(self, column: str, value: Any) -> "SupabaseTable":
        self._params[column] = f"neq.{value}"
        return self

    def gt(self, column: str, value: Any) -> "SupabaseTable":
        self._params[column] = f"gt.{value}"
        return self

    def gte(self, column: str, value: Any) -> "SupabaseTable":
        self._params[column] = f"gte.{value}"
        return self

    def lt(self, column: str, value: Any) -> "SupabaseTable":
        self._params[column] = f"lt.{value}"
        return self

    def lte(self, column: str, value: Any) -> "SupabaseTable":
        self._params[column] = f"lte.{value}"
        return self

    def like(self, column: str, pattern: str) -> "SupabaseTable":
        self._params[column] = f"like.{pattern}"
        return self

    def ilike(self, column: str, pattern: str) -> "SupabaseTable":
        self._params[column] = f"ilike.{pattern}"
        return self

    def is_(self, column: str, value: Any) -> "SupabaseTable":
        self._params[column] = f"is.{value}"
        return self

    def in_(self, column: str, values: list) -> "SupabaseTable":
        quoted = ",".join(f'"{v}"' if isinstance(v, str) else str(v) for v in values)
        self._params[column] = f"in.({quoted})"
        return self

    def contains(self, column: str, value: Any) -> "SupabaseTable":
        self._params[column] = f"cs.{value}"
        return self

    @property
    def not_(self) -> "_NegatedFilter":
        return _NegatedFilter(self)

    def or_(self, conditions: str) -> "SupabaseTable":
        self._params["or"] = f"({conditions})"
        return self

    def order(self, column: str, desc: bool = False) -> "SupabaseTable":
        direction = "desc" if desc else "asc"
        existing = self._params.get("order", "")
        if existing:
            self._params["order"] = f"{existing},{column}.{direction}"
        else:
            self._params["order"] = f"{column}.{direction}"
        return self

    def limit(self, count: int) -> "SupabaseTable":
        self._headers["Range"] = f"0-{count - 1}"
        return self

    def range(self, start: int, end: int) -> "SupabaseTable":
        self._headers["Range"] = f"{start}-{end}"
        return self

    def text_search(self, column: str, query: str, config: str = "english") -> "SupabaseTable":
        self._params[column] = f"phfts({config}).{query}"
        return self

    def execute(self) -> "SupabaseResponse":
        with httpx.Client(timeout=30.0) as client:
            if self._method == "GET":
                resp = client.get(self._url, headers=self._headers, params=self._params)
            elif self._method == "POST":
                resp = client.post(self._url, headers=self._headers, params=self._params, json=self._body)
            elif self._method == "PATCH":
                resp = client.patch(self._url, headers=self._headers, params=self._params, json=self._body)
            elif self._method == "DELETE":
                resp = client.delete(self._url, headers=self._headers, params=self._params)
            else:
                raise ValueError(f"Unsupported method: {self._method}")

        resp.raise_for_status()
        data = resp.json() if resp.content else (None if self._single_mode else [])
        count = None
        if self._count_mode and "content-range" in resp.headers:
            # Format: "0-9/100" or "*/100"
            cr = resp.headers["content-range"]
            if "/" in cr:
                count = int(cr.split("/")[1])
        return SupabaseResponse(data=data, count=count)


class _NegatedFilter:
    """Wraps a SupabaseTable to negate the next filter."""

    def __init__(self, table: SupabaseTable):
        self._table = table

    def is_(self, column: str, value: Any) -> SupabaseTable:
        self._table._params[column] = f"not.is.{value}"
        return self._table

    def eq(self, column: str, value: Any) -> SupabaseTable:
        self._table._params[column] = f"not.eq.{value}"
        return self._table

    def in_(self, column: str, values: list) -> SupabaseTable:
        quoted = ",".join(f'"{v}"' if isinstance(v, str) else str(v) for v in values)
        self._table._params[column] = f"not.in.({quoted})"
        return self._table


class SupabaseResponse:
    """Mimics the supabase-py response object."""

    def __init__(self, data: Any = None, count: Optional[int] = None):
        self.data = data
        self.count = count


class SupabaseClient:
    """Lightweight Supabase client using direct PostgREST HTTP calls."""

    def __init__(self, url: str, key: str):
        self.url = url.rstrip("/")
        self.key = key

    def table(self, name: str) -> SupabaseTable:
        return SupabaseTable(self.url, self.key, name)

    def rpc(self, fn: str, params: Optional[Dict] = None) -> SupabaseResponse:
        """Call a Postgres function via PostgREST RPC."""
        rpc_url = f"{self.url}/rest/v1/rpc/{fn}"
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(rpc_url, headers=headers, json=params or {})
        resp.raise_for_status()
        data = resp.json() if resp.content else []
        if isinstance(data, list):
            return SupabaseResponse(data=data)
        return SupabaseResponse(data=[data])


@lru_cache(maxsize=1)
def get_supabase_client() -> SupabaseClient:
    """
    Returns a cached lightweight Supabase client.
    Uses direct PostgREST HTTP calls (no supabase-py SDK).
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

    return SupabaseClient(url, key)
