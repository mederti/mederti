"""Shared utilities for Mederti drug universe importers."""
from __future__ import annotations

import logging
import re
import pandas as pd
from supabase import Client

log = logging.getLogger(__name__)
BATCH_SIZE = 200


def clean(val) -> str | None:
    if pd.isna(val) if hasattr(pd, 'isna') else val != val:
        return None
    s = str(val).strip()
    return None if s in ("", "nan", "NaN", "None", "-") else s


def parse_date(val) -> str | None:
    from datetime import datetime
    v = clean(val)
    if not v:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d %b %Y", "%d-%b-%Y", "%Y%m%d"):
        try:
            return datetime.strptime(v, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def extract_strength(product_name: str) -> str | None:
    if not product_name:
        return None
    m = re.search(r'\d+\.?\d*\s*(?:mg|g|mcg|microgram|µg|ml|mL|%|IU|units?)',
                  product_name, re.IGNORECASE)
    return m.group(0).strip() if m else None


def normalise_dosage_form(raw: str | None) -> str | None:
    if not raw:
        return None
    r = raw.lower()
    for keyword, canonical in [
        ("capsule",    "capsule"),
        ("tablet",     "tablet"),
        ("injection",  "injection"),
        ("solution",   "solution"),
        ("suspension", "suspension"),
        ("cream",      "cream"),
        ("ointment",   "ointment"),
        ("patch",      "patch"),
        ("inhaler",    "inhaler"),
        ("powder",     "powder"),
        ("gel",        "gel"),
        ("drops",      "drops"),
        ("syrup",      "syrup"),
        ("spray",      "spray"),
        ("lozenge",    "lozenge"),
        ("infusion",   "infusion"),
        ("implant",    "implant"),
        ("suppository","suppository"),
    ]:
        if keyword in r:
            return canonical
    return raw.split()[0].lower()


def extract_ingredient_names(raw: str | None) -> list[str]:
    """Parse a comma/semicolon delimited ingredient string into clean name list."""
    if not raw:
        return []
    names = []
    for part in raw.replace(";", ",").split(","):
        part = part.strip()
        tokens = part.split()
        # Drop tokens that are purely numeric or look like quantities
        name_only = " ".join(
            t for t in tokens
            if not re.match(r'^\d', t) and not re.match(r'^\d*\.?\d+\s*(mg|g|mcg|ml)', t, re.I)
        ).strip().lower()
        if name_only and len(name_only) > 2:
            names.append(name_only)
    return names


def dedup_rows(rows: list[dict], key_col: str) -> list[dict]:
    """Deduplicate rows by a key column (case-insensitive for strings)."""
    seen = set()
    out = []
    for row in rows:
        k = row.get(key_col, '')
        if isinstance(k, str):
            k = k.lower().strip()
        if k in seen:
            continue
        seen.add(k)
        out.append(row)
    return out


def upsert_batches(supabase: Client, table: str, rows: list[dict], conflict_col: str) -> int:
    # Deduplicate by first conflict column to avoid "cannot affect row a second time"
    dedup_key = conflict_col.split(',')[0].strip()
    # For generated columns like name_normalised, deduplicate by the source column
    if dedup_key == 'name_normalised':
        rows = dedup_rows(rows, 'name')
    elif dedup_key == 'source':
        # Composite key: deduplicate by (source, registry_id) combo
        seen = set()
        deduped = []
        for r in rows:
            k = (r.get('source', ''), r.get('registry_id', ''))
            if k not in seen:
                seen.add(k)
                deduped.append(r)
        rows = deduped
    else:
        rows = dedup_rows(rows, dedup_key)

    total = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        supabase.table(table).upsert(batch, on_conflict=conflict_col).execute()
        total += len(batch)
        log.info(f"  {table}: upserted {total}/{len(rows)}")
    return total


def resolve_col(df: pd.DataFrame, candidates: list[str]) -> str | None:
    cols_lower = {c.lower(): c for c in df.columns}
    for c in candidates:
        if c.lower() in cols_lower:
            return cols_lower[c.lower()]
    return None


def _paginate_table(supabase: Client, table: str, select: str,
                    eq_filter: tuple | None = None, page_size: int = 1000) -> list[dict]:
    """Paginate through all rows of a Supabase table. Creates fresh query per page."""
    all_data = []
    offset = 0
    while True:
        q = supabase.table(table).select(select)
        if eq_filter:
            q = q.eq(eq_filter[0], eq_filter[1])
        result = q.range(offset, offset + page_size - 1).execute()
        all_data.extend(result.data)
        if len(result.data) < page_size:
            break
        offset += page_size
    return all_data


def load_sponsor_id_map(supabase: Client) -> dict[str, str]:
    data = _paginate_table(supabase, "sponsors", "id, name_normalised")
    return {r["name_normalised"]: r["id"] for r in data}


def load_ingredient_id_map(supabase: Client) -> dict[str, str]:
    data = _paginate_table(supabase, "active_ingredients", "id, name_normalised")
    return {r["name_normalised"]: r["id"] for r in data}


def load_product_id_map(supabase: Client, country: str) -> dict[str, str]:
    """Returns map of registry_id -> uuid for a given country."""
    data = _paginate_table(supabase, "drug_products", "id, registry_id",
                           eq_filter=("country", country))
    return {r["registry_id"]: r["id"] for r in data}
