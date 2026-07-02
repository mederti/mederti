"""
NADAC historical backfill
─────────────────────────
Populate drug_pricing_history with a MONTHLY US price series so the drug-page
price-trend forecast (frontend/app/api/insights/price-trends) has enough history
to fit. The weekly NADAC cron only ingests the *latest* snapshot; this fills in
the past.

Each CMS yearly dataset ("NADAC ... 2024/2025/2026") already contains every
weekly snapshot for that year. We sample ONE snapshot per month across the
available years and upsert them through the normal NADACScraper path.

Why this is safe + volume-bounded:
  • dedup_hash includes (effective_date, price), so an unchanged NADAC price
    collapses to a SINGLE row at its true change-date no matter how many monthly
    snapshots contain it. Total rows ≈ number of real price changes, not
    months × NDCs. Re-runs are idempotent and it's safe to run alongside cron.
  • The resolver/index is built ONCE and reused across snapshots (the expensive
    part), so 18 months is ~18 cheap fetches, not 18 index rebuilds.

Usage:
  # Dry run — fetch the most recent historical snapshot, show sample +
  # resolution stats, write NOTHING:
  MEDERTI_DRY_RUN=1 python3 -m backend.scripts.nadac_backfill

  # Execute the backfill (default: last 18 months, monthly-sampled):
  python3 -m backend.scripts.nadac_backfill --months 18
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from collections import defaultdict

from backend.scrapers.pricing.nadac_scraper import NADACScraper, PAGE_SIZE

METASTORE_URL = "https://data.medicaid.gov/api/1/metastore/schemas/dataset/items"
DATASTORE_URL = "https://data.medicaid.gov/api/1/datastore/query/{dataset_id}/0"
DATASET_TITLE = re.compile(r"^NADAC \(National Average Drug Acquisition Cost\) (\d{4})$")


def discover_datasets(scraper: NADACScraper) -> dict[int, str]:
    """year -> dataset identifier, for every NADAC yearly dataset."""
    items = scraper._get_json(METASTORE_URL)
    out: dict[int, str] = {}
    for item in items:
        m = DATASET_TITLE.match((item.get("title") or "").strip())
        if m:
            out[int(m.group(1))] = item["identifier"]
    return out


def latest_snapshot_in_month(scraper: NADACScraper, dataset_id: str, ym: str) -> str | None:
    """Latest weekly as_of_date within calendar month `ym` (YYYY-MM), or None.

    One cheap 1-row query per month — the datastore SQL endpoint rejects
    DISTINCT and wants distribution (not dataset) ids, so per-month range
    probes against the regular query endpoint are the reliable path.
    """
    y, m = (int(x) for x in ym.split("-"))
    lo = f"{y}-{m:02d}-01"
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    hi = f"{ny}-{nm:02d}-01"
    page = scraper._get_json(DATASTORE_URL.format(dataset_id=dataset_id), params={
        "limit": 1,
        "properties[]": "as_of_date",
        "conditions[0][property]": "as_of_date", "conditions[0][value]": lo, "conditions[0][operator]": ">=",
        "conditions[1][property]": "as_of_date", "conditions[1][value]": hi, "conditions[1][operator]": "<",
        "sorts[0][property]": "as_of_date", "sorts[0][order]": "desc",
    })
    res = page.get("results", [])
    return res[0]["as_of_date"][:10] if res and res[0].get("as_of_date") else None


def fetch_snapshot(scraper: NADACScraper, dataset_id: str, as_of_date: str,
                   max_pages: int = 100) -> list[dict]:
    """All rows for one weekly snapshot (~30k)."""
    url = DATASTORE_URL.format(dataset_id=dataset_id)
    rows: list[dict] = []
    offset = 0
    for _ in range(max_pages):
        page = scraper._get_json(url, params={
            "limit": PAGE_SIZE, "offset": offset,
            "conditions[0][property]": "as_of_date",
            "conditions[0][value]": as_of_date,
            "conditions[0][operator]": "=",
        })
        res = page.get("results", [])
        rows.extend(res)
        if len(res) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return rows


def monthly_targets(scraper: NADACScraper, datasets: dict[int, str], months: int) -> list[tuple[str, str, str]]:
    """Pick the LAST snapshot of each of the trailing `months` calendar months.
    Returns [(YYYY-MM, dataset_id, as_of_date)] ascending by month. Months with
    no snapshot in their year's dataset are skipped."""
    from datetime import date

    today = date.today()
    out: list[tuple[str, str, str]] = []
    y, m = today.year, today.month
    wanted: list[str] = []
    for _ in range(months):
        wanted.append(f"{y}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    for ym in sorted(wanted):
        year = int(ym[:4])
        did = datasets.get(year)
        if not did:
            continue
        snap = latest_snapshot_in_month(scraper, did, ym)
        if snap:
            out.append((ym, did, snap))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--months", type=int, default=18, help="how many trailing months to backfill")
    args = ap.parse_args()
    dry = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"

    scraper = NADACScraper()

    # Build the resolver ONCE and reuse it across every snapshot's upsert.
    print("Building INN resolver/index (once)…", flush=True)
    resolver = scraper._build_resolver()
    scraper._build_resolver = lambda: resolver  # type: ignore[method-assign]
    if resolver is None:
        print("  WARNING: resolver unavailable — rows will land with drug_id NULL")

    datasets = discover_datasets(scraper)
    if not datasets:
        print("No NADAC datasets found in metastore", file=sys.stderr)
        return 1
    print(f"NADAC yearly datasets: {sorted(datasets)}")

    targets = monthly_targets(scraper, datasets, args.months)
    print(f"Monthly targets ({len(targets)}): {targets[0][0]}..{targets[-1][0]}")

    if dry:
        # Probe the most recent historical snapshot only; write nothing.
        ym, did, as_of = targets[-1]
        print(f"\nDRY RUN — snapshot {ym} (as_of {as_of}, dataset {did})")
        rows = fetch_snapshot(scraper, did, as_of, max_pages=3)  # ~6k rows sample
        norm = scraper.normalize({"rows": rows})
        print(f"  fetched {len(rows)} rows (3-page sample), normalized {len(norm)}")
        eff_months = defaultdict(int)
        for r in norm:
            eff_months[(r.get("effective_date") or "")[:7]] += 1
        print(f"  effective_date months in sample: {dict(sorted(eff_months.items()))}")
        # resolution spot-check on the first 200 names
        resolved = 0
        if resolver:
            for r in norm[:200]:
                if resolver(r.get("generic_name") or r.get("product_name") or ""):
                    resolved += 1
            print(f"  resolver hit {resolved}/200 sampled names")
        for r in norm[:6]:
            print(f"    {r['effective_date']}  {r['product_name'][:42]:42} "
                  f"NDC {r['identifier_value']:>12}  ${r['unit_price']} {r['strength']}")
        print("\nDry run complete — no rows written. Re-run without MEDERTI_DRY_RUN=1 to execute.")
        return 0

    total = {"upserted": 0, "resolved": 0, "skipped": 0}
    for i, (ym, did, as_of) in enumerate(targets, 1):
        rows = fetch_snapshot(scraper, did, as_of)
        norm = scraper.normalize({"rows": rows})
        counts = scraper.upsert(norm)
        for k in total:
            total[k] += counts.get(k, 0)
        print(f"[{i}/{len(targets)}] {ym} as_of={as_of}: fetched {len(rows)}, "
              f"upserted {counts['upserted']}, resolved {counts['resolved']}", flush=True)

    print(f"\nBackfill complete. upserted={total['upserted']} "
          f"resolved={total['resolved']} skipped={total['skipped']}")
    return 0


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    sys.exit(main())
