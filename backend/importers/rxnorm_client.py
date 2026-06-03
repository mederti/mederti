"""
Thin wrapper around the RxNav/RxNorm REST API.

Base URL: https://rxnav.nlm.nih.gov/REST
No authentication required.
Soft rate-limit: ~10 req/sec (100 ms between calls).
"""
from __future__ import annotations

import time
from typing import Optional

import httpx

from backend.utils.logger import get_logger
from backend.utils.retry import with_exponential_backoff

log = get_logger("mederti.rxnorm")

_BASE = "https://rxnav.nlm.nih.gov/REST"
_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "Mederti-Importer/1.0 (https://mederti.com)",
}
_client = httpx.Client(headers=_HEADERS, timeout=15.0, follow_redirects=True)
_MIN_INTERVAL = 0.12   # 120 ms → ~8 req/sec
_last_call: float = 0.0


def _get(path: str, params: dict | None = None) -> dict:
    """Rate-limited GET with exponential back-off on HTTP errors."""
    global _last_call
    elapsed = time.monotonic() - _last_call
    if elapsed < _MIN_INTERVAL:
        time.sleep(_MIN_INTERVAL - elapsed)

    @with_exponential_backoff(
        max_attempts=3,
        base_delay=2.0,
        max_delay=30.0,
        exceptions=(httpx.HTTPError, httpx.TimeoutException),
    )
    def _fetch() -> dict:
        r = _client.get(f"{_BASE}{path}", params=params)
        r.raise_for_status()
        return r.json()

    result = _fetch()
    _last_call = time.monotonic()
    return result


# ── Public API ────────────────────────────────────────────────────────────────

def get_rxcui(name: str) -> Optional[str]:
    """
    Resolve a drug name to its RxCUI.
    Uses search=2 (approximate match).
    Returns the first RxCUI string, or None.
    """
    try:
        data = _get("/rxcui.json", {"name": name, "search": "2"})
        ids = (data.get("idGroup") or {}).get("rxnormId") or []
        return ids[0] if ids else None
    except Exception as e:
        log.debug(f"get_rxcui({name!r}): {e}")
        return None


def get_rxcui_approx(name: str) -> Optional[dict]:
    """
    Approximate-match a name to a RxNorm concept. Bridges foreign brand spellings
    that exact search misses — e.g. EU brand "Gazyvaro" → the US "Gazyva" concept
    (RxNorm is US-centric). Returns the rank-1 candidate {"rxcui","name","score"}
    or None. The caller should cross-confirm (e.g. against the UNII registry)
    before treating an approximate hit as high-confidence.
    """
    try:
        data = _get("/approximateTerm.json", {"term": name, "maxEntries": "3"})
        cands = (data.get("approximateGroup") or {}).get("candidate") or []
        for c in cands:
            if c.get("rxcui") and c.get("rank") == "1":
                return {"rxcui": c["rxcui"], "name": c.get("name"), "score": float(c.get("score") or 0)}
        return None
    except Exception as e:
        log.debug(f"get_rxcui_approx({name!r}): {e}")
        return None


def get_atc_code(rxcui: str) -> Optional[str]:
    """
    Look up the ATC code for a given RxCUI via the property endpoint.
    Returns the ATC string (e.g. 'J01CA04') or None.
    """
    try:
        data = _get(f"/rxcui/{rxcui}/property.json", {"propName": "ATC"})
        concepts = (data.get("propConceptGroup") or {}).get("propConcept") or []
        for c in concepts:
            if c.get("propName") == "ATC" and c.get("propValue"):
                return c["propValue"]
        return None
    except Exception as e:
        log.debug(f"get_atc_code({rxcui!r}): {e}")
        return None


def get_class_members(atc_prefix: str) -> list[dict]:
    """
    Fetch all drugs in a given ATC class from RxNorm.
    Returns list of {"rxcui": str, "name": str} dicts.

    Note: RxNorm only covers ATC codes that appear in their dataset;
    not all ATC classes return members.
    """
    try:
        data = _get(
            "/rxclass/class/classMembers.json",
            {"classId": atc_prefix, "relaSource": "ATC"},
        )
        members = (data.get("drugMemberGroup") or {}).get("drugMember") or []
        results = []
        for m in members:
            mi = m.get("minConcept") or {}
            rxcui = mi.get("rxcui", "").strip()
            name = mi.get("name", "").strip()
            if rxcui and name:
                results.append({"rxcui": rxcui, "name": name})
        return results
    except Exception:
        return []


def get_base_ingredient(rxcui: str) -> Optional[dict]:
    """
    Resolve a RxCUI (which may be a salt/branded/clinical-drug concept) to its
    base ingredient concept — the INN. This is the salt→base step:

        "atorvastatin calcium" (rxcui 83367) → {"rxcui": "83366", "name": "atorvastatin"}

    Prefers a single-ingredient IN; for multi-ingredient products returns the MIN
    (multi-ingredient) concept so callers can detect combinations. Returns
    {"rxcui", "name", "tty"} or None.
    """
    try:
        data = _get(f"/rxcui/{rxcui}/related.json", {"tty": "IN MIN"})
        groups = (data.get("relatedGroup") or {}).get("conceptGroup") or []
        ins: list[dict] = []
        mins: list[dict] = []
        for g in groups:
            tty = g.get("tty")
            for cp in g.get("conceptProperties") or []:
                rec = {"rxcui": cp.get("rxcui"), "name": (cp.get("name") or "").strip(), "tty": tty}
                if not rec["rxcui"] or not rec["name"]:
                    continue
                (ins if tty == "IN" else mins).append(rec)
        # Single base ingredient is the clean case.
        if len(ins) == 1:
            return ins[0]
        if len(ins) > 1:
            # Multi-ingredient: surface the MIN if present, else flag ambiguity.
            return mins[0] if mins else {"rxcui": None, "name": " / ".join(i["name"] for i in ins), "tty": "MULTI"}
        if mins:
            return mins[0]
        return None
    except Exception as e:
        log.debug(f"get_base_ingredient({rxcui!r}): {e}")
        return None


def get_unii(rxcui: str) -> Optional[str]:
    """
    Look up the FDA UNII (substance identifier) for a RxCUI via the codes
    property endpoint. RxNorm carries it as the 'UNII_CODE' attribute.

        atorvastatin (rxcui 83366) → '48A5M73Z4Q'

    Returns the UNII string or None.
    """
    try:
        data = _get(f"/rxcui/{rxcui}/allProperties.json", {"prop": "codes"})
        props = (data.get("propConceptGroup") or {}).get("propConcept") or []
        for p in props:
            if p.get("propName") in ("UNII_CODE", "UNII") and p.get("propValue"):
                return p["propValue"].strip()
        return None
    except Exception as e:
        log.debug(f"get_unii({rxcui!r}): {e}")
        return None


def get_related_ingredients(rxcui: str) -> list[str]:
    """
    Return the ingredient names related to this RxCUI via allrelated.json.
    Filters to tty IN (IN, MIN, PIN) — base ingredient concepts.
    Useful for finding the canonical drug name.
    """
    try:
        data = _get(f"/rxcui/{rxcui}/allrelated.json")
        groups = (data.get("allRelatedGroup") or {}).get("conceptGroup") or []
        names: list[str] = []
        for g in groups:
            if g.get("tty") in ("IN", "MIN", "PIN"):
                for cp in g.get("conceptProperties") or []:
                    n = (cp.get("name") or "").strip()
                    if n:
                        names.append(n)
        return list(dict.fromkeys(names))   # deduplicate preserving order
    except Exception as e:
        log.debug(f"get_related_ingredients({rxcui!r}): {e}")
        return []
