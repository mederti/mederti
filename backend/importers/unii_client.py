"""
Thin client for the FDA/NLM UNII substance registry.

UNII (Unique Ingredient Identifier) is the FDA's free, authoritative substance
key (fdasis.nlm.nih.gov). The modern public service is NCATS GSRS, which the
FDA's Substance Registration System feeds:

    https://gsrs.ncats.nih.gov/api/v1/substances/search?q=<name>

We use this as the *fallback* UNII source: RxNorm carries UNII_CODE for most
small molecules, but misses complex substances and biologics (e.g. heparin,
many monoclonal antibodies). The UNII registry covers those.

No authentication. Be polite — ~1 req/sec.
"""
from __future__ import annotations

import time
from typing import Optional

import httpx

from backend.utils.logger import get_logger
from backend.utils.retry import with_exponential_backoff

log = get_logger("mederti.unii")

_BASE = "https://gsrs.ncats.nih.gov/api/v1"
_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "Mederti-Importer/1.0 (https://mederti.com)",
}
_client = httpx.Client(headers=_HEADERS, timeout=25.0, follow_redirects=True)
_MIN_INTERVAL = 0.5
_last_call: float = 0.0

# Circuit breaker: GSRS is a best-effort *fallback* UNII source. When it is down
# (site-wide 500s/timeouts), retrying every unresolved name burns ~8s apiece and
# can turn a bulk backfill into a multi-day job. After this many consecutive
# failures we stop calling it for the rest of the process and let callers fall
# back to whatever they had (review queue / medium confidence). A later success
# resets it.
_GSRS_FAIL_THRESHOLD = 5
_consecutive_failures = 0
_circuit_open = False


def _get(path: str, params: dict | None = None) -> dict:
    global _last_call
    elapsed = time.monotonic() - _last_call
    if elapsed < _MIN_INTERVAL:
        time.sleep(_MIN_INTERVAL - elapsed)

    @with_exponential_backoff(
        max_attempts=3, base_delay=2.0, max_delay=30.0,
        exceptions=(httpx.HTTPError, httpx.TimeoutException),
    )
    def _fetch() -> dict:
        r = _client.get(f"{_BASE}{path}", params=params)
        r.raise_for_status()
        return r.json()

    result = _fetch()
    _last_call = time.monotonic()
    return result


def get_unii_by_name(name: str) -> Optional[str]:
    """
    Resolve a substance name to its UNII via the UNII registry.

    Prefers an exact (case-insensitive) name match; falls back to the
    top search hit only when it is an unambiguous single result.

        "heparin" → "T2410KM04A"

    Returns the UNII string or None.
    """
    global _consecutive_failures, _circuit_open
    name = (name or "").strip()
    if not name:
        return None
    if _circuit_open:
        return None
    try:
        data = _get("/substances/search", {"q": name, "top": 5})
        # A completed response (even an empty match) means GSRS is up — reset.
        _consecutive_failures = 0
        content = data.get("content") or []
        if not content:
            return None
        target = name.upper()
        # 1. exact display-name match
        for c in content:
            cname = (c.get("_name") or "").strip().upper()
            if cname == target and c.get("approvalID"):
                return c["approvalID"].strip()
        # 2. exact match against any associated name
        for c in content:
            for n in c.get("names") or []:
                if (n.get("name") or "").strip().upper() == target and c.get("approvalID"):
                    return c["approvalID"].strip()
        # 3. single unambiguous hit — the registry matched the query to one
        #    substance even though its display name differs (e.g. a brand name
        #    "GAZYVARO" matching substance "OBINUTUZUMAB"). Safe as a
        #    cross-confirmation signal.
        if len(content) == 1 and content[0].get("approvalID"):
            return content[0]["approvalID"].strip()
        return None
    except Exception as e:
        _consecutive_failures += 1
        if _consecutive_failures >= _GSRS_FAIL_THRESHOLD and not _circuit_open:
            _circuit_open = True
            log.warning(
                f"GSRS UNII lookup disabled for this run after "
                f"{_consecutive_failures} consecutive failures (service appears down). "
                f"Remaining rows resolve without the name-based UNII fallback."
            )
        log.debug(f"get_unii_by_name({name!r}): {e}")
        return None


if __name__ == "__main__":
    import sys
    for n in sys.argv[1:] or ["heparin", "atorvastatin", "obinutuzumab"]:
        print(f"{n!r:20} → UNII {get_unii_by_name(n)}")
