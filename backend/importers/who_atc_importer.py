"""
WHO ATC/DDD Index Importer
──────────────────────────
Source:  WHO Collaborating Centre for Drug Statistics Methodology
URL:     https://atcddd.fhi.no/atc_ddd_index/

Populates the `atc_codes` table with the full 5-level ATC hierarchy plus
Defined Daily Dose (DDD) values for every level-5 substance.

Why this matters for Mederti
────────────────────────────
The `drugs` table already has an `atc_code` column (populated piecemeal by
regulator scrapers) and an `atc_description` column (often null). Most of
our regulator feeds give us the code but not the canonical WHO name.

Once this importer runs, every drug page can show:
  • the canonical substance name
  • the four parent classifications
  • DDD value (for normalised pricing comparisons)

WHO publishes the ATC index as a publicly-browsable HTML site. We scrape
the level-1 anatomical groups, recurse into each child level, and store
the full tree.

Usage
─────
    python3 -m backend.importers.who_atc_importer

Env:
    SUPABASE_URL                — required
    SUPABASE_SERVICE_ROLE_KEY   — required
    MEDERTI_DRY_RUN=1           — optional, prints diff without writing

Cadence
───────
Run once per year (WHO publishes updates each January). Idempotent —
re-running upserts on the code primary key.
"""
from __future__ import annotations

import os
import re
import sys
import time
from typing import Any

import httpx
from bs4 import BeautifulSoup

# Reuse Mederti's existing Supabase client helper
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.utils.db import get_supabase_client  # noqa: E402


BASE_URL = "https://atcddd.fhi.no/atc_ddd_index/"
RATE_LIMIT_SECONDS = 1.5  # be polite to WHOCC
TIMEOUT = 30.0
USER_AGENT = "Mederti-ATC-Importer/1.0 (drug-shortage-intelligence; contact: data@mederti.com)"

# 14 top-level anatomical groups
ANATOMICAL_GROUPS = ["A", "B", "C", "D", "G", "H", "J", "L", "M", "N", "P", "R", "S", "V"]

DRY_RUN = os.environ.get("MEDERTI_DRY_RUN", "0") == "1"


def fetch(code: str = "", show_description: str = "yes") -> str:
    """Fetch a single ATC index page. Empty code → top-level index."""
    params: dict[str, str] = {"showdescription": show_description}
    if code:
        params["code"] = code

    with httpx.Client(timeout=TIMEOUT, headers={"User-Agent": USER_AGENT}) as client:
        r = client.get(BASE_URL, params=params)
        r.raise_for_status()
        return r.text


def parse_atc_page(html: str) -> list[dict[str, Any]]:
    """
    Parse a WHO ATC index page.

    The WHO ATC index has two common HTML shapes for code anchors:

      (a) Description INSIDE the link (common at levels 1–4 inside <b>):
            <b><a href="./?code=A">ALIMENTARY TRACT AND METABOLISM</a></b>

      (b) Code INSIDE the link, description as next-sibling text (level 5):
            <a href="./?code=A10BA02">A10BA02</a> metformin

    We handle both and dedupe by code.
    """
    soup = BeautifulSoup(html, "html.parser")
    by_code: dict[str, dict[str, Any]] = {}

    for a in soup.find_all("a", href=re.compile(r"code=[A-Z0-9]+")):
        href = a.get("href", "")
        m = re.search(r"code=([A-Z0-9]+)", href)
        if not m:
            continue
        code = m.group(1)
        link_text = a.get_text(" ", strip=True)

        # Shape (a): link text is the description (not just the code itself)
        if link_text and link_text.strip().upper() != code:
            description = link_text.strip()
        else:
            # Shape (b): description follows the link as plain text up to <br/> or next <a>
            desc_parts: list[str] = []
            sib = a.next_sibling
            while sib is not None:
                name = getattr(sib, "name", None)
                if name in ("br", "a", "table"):
                    break
                text = sib if isinstance(sib, str) else (sib.get_text(" ", strip=True) if hasattr(sib, "get_text") else "")
                if text:
                    desc_parts.append(str(text).strip())
                sib = sib.next_sibling
            description = " ".join(p for p in desc_parts if p).strip()

        # Cleanup
        description = re.sub(r"\s{2,}", " ", description).strip(" ,;:-")
        if not description:
            continue

        # Skip nav links and accidental matches
        if description.lower() in {"new search", "hide text from guidelines", "show text from guidelines"}:
            continue
        if description.lower().startswith(("new search", "hide text", "show text")):
            continue

        # First entry per code wins (don't overwrite with junk later)
        if code not in by_code:
            by_code[code] = {
                "code": code,
                "description": description,
                "level": _level_for(code),
            }

    return list(by_code.values())


def parse_ddds(html: str, code: str) -> list[dict[str, Any]]:
    """Parse the DDD table at the bottom of a level-5 ATC page."""
    soup = BeautifulSoup(html, "html.parser")
    ddds: list[dict[str, Any]] = []

    # WHO DDD table has headers: ATC code · Name · DDD · U · Adm.R · Note
    for tbl in soup.find_all("table"):
        rows = tbl.find_all("tr")
        if len(rows) < 2:
            continue
        header = [c.get_text(" ", strip=True).lower() for c in rows[0].find_all(["td", "th"])]
        if not any("ddd" in h for h in header):
            continue
        for row in rows[1:]:
            cells = [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])]
            if len(cells) < 4:
                continue
            row_code = cells[0].strip()
            if row_code != code:
                continue
            ddd_value: float | None = None
            try:
                ddd_value = float(cells[2].replace(",", "."))
            except (ValueError, IndexError):
                pass
            unit  = cells[3].strip() if len(cells) > 3 else None
            route = cells[4].strip() if len(cells) > 4 else None
            note  = cells[5].strip() if len(cells) > 5 else None
            ddds.append({
                "ddd_value": ddd_value,
                "ddd_unit": unit or None,
                "ddd_route": route or None,
                "ddd_note": note or None,
            })
    return ddds


def _level_for(code: str) -> int:
    """ATC code length → tree level. A=1, A10=2, A10B=3, A10BA=4, A10BA02=5."""
    n = len(code)
    if n == 1: return 1
    if n == 3: return 2
    if n == 4: return 3
    if n == 5: return 4
    if n == 7: return 5
    return 0  # unknown


def _parent_code(code: str) -> str | None:
    """Return parent code in the ATC tree (one level shallower)."""
    n = len(code)
    if n == 7: return code[:5]
    if n == 5: return code[:4]
    if n == 4: return code[:3]
    if n == 3: return code[:1]
    return None


def walk_tree() -> list[dict[str, Any]]:
    """
    Walk the ATC tree breadth-first from the 14 anatomical groups down to
    level 5 substances. Returns the flat list of all codes with descriptions.
    """
    queue: list[str] = list(ANATOMICAL_GROUPS)
    seen: set[str] = set()
    rows: list[dict[str, Any]] = []

    while queue:
        code = queue.pop(0)
        if code in seen:
            continue
        seen.add(code)

        try:
            html = fetch(code)
        except httpx.HTTPError as e:
            print(f"  ! fetch failed for {code}: {e}", flush=True)
            time.sleep(RATE_LIMIT_SECONDS * 2)
            continue

        children = parse_atc_page(html)
        # Self-row: the page also lists its own anchor
        for row in children:
            if row["code"] not in seen and row["code"] != code:
                queue.append(row["code"])
            row["parent_code"] = _parent_code(row["code"])
            row["source_url"] = f"{BASE_URL}?code={row['code']}&showdescription=yes"
            rows.append(row)

            # Level-5: also parse DDD
            if row["level"] == 5:
                for ddd in parse_ddds(html, row["code"]):
                    row.update(ddd)
                    break  # take first DDD row (we can extend later)

        time.sleep(RATE_LIMIT_SECONDS)
        if len(rows) % 50 == 0:
            print(f"  … {len(rows)} ATC codes parsed so far", flush=True)

    return rows


def upsert_batch(supabase: Any, rows: list[dict[str, Any]]) -> int:
    """Upsert by primary key (code). Returns affected row count."""
    if not rows:
        return 0
    if DRY_RUN:
        print(f"  [DRY RUN] would upsert {len(rows)} rows; first: {rows[0]}", flush=True)
        return len(rows)
    res = supabase.table("atc_codes").upsert(rows, on_conflict="code").execute()
    return len(res.data or [])


def backfill_drug_descriptions(supabase: Any) -> int:
    """Update drugs.atc_description from atc_codes where it's NULL or empty."""
    if DRY_RUN:
        print("  [DRY RUN] would backfill drugs.atc_description", flush=True)
        return 0
    # Use Supabase rpc or raw SQL via the PostgREST update endpoint
    # Easier: pull drugs with atc_code but no description, look up in atc_codes, update.
    drugs = (
        supabase.table("drugs")
        .select("id, atc_code, atc_description")
        .not_.is_("atc_code", "null")
        .execute()
        .data or []
    )
    targets = [d for d in drugs if not d.get("atc_description")]
    if not targets:
        print("  No drugs need backfill (all atc_description populated)", flush=True)
        return 0

    codes = list({d["atc_code"] for d in targets})
    atc_rows = (
        supabase.table("atc_codes")
        .select("code, description")
        .in_("code", codes)
        .execute()
        .data or []
    )
    desc_map = {r["code"]: r["description"] for r in atc_rows}

    updated = 0
    for d in targets:
        desc = desc_map.get(d["atc_code"])
        if not desc:
            continue
        supabase.table("drugs").update({"atc_description": desc}).eq("id", d["id"]).execute()
        updated += 1

    return updated


def main() -> int:
    print("[WHO ATC importer] Starting walk from 14 anatomical groups…", flush=True)
    rows = walk_tree()
    print(f"[WHO ATC importer] Collected {len(rows)} ATC codes", flush=True)

    if not rows:
        print("  ! No rows collected — aborting (check network / WHOCC HTML structure)", flush=True)
        return 1

    supabase = get_supabase_client()

    # Upsert in batches of 500 to keep payloads small
    batch_size = 500
    total = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i + batch_size]
        total += upsert_batch(supabase, chunk)
    print(f"[WHO ATC importer] Upserted {total} rows into atc_codes", flush=True)

    # Backfill drugs.atc_description
    backfilled = backfill_drug_descriptions(supabase)
    print(f"[WHO ATC importer] Backfilled {backfilled} drugs with WHO descriptions", flush=True)

    print("[WHO ATC importer] Done ✓", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
