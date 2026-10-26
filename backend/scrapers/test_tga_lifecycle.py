"""
Unit tests for TGA shortage-row lifecycle (no network, no real DB):
  • a re-dated ARTG moves its open row forward instead of leaving it open
  • the duplicate-payload path only re-verifies rows of the unchanged payload
    and never re-activates stale rows as 'active'

Run from the repo root (no pytest needed):
    python3 -m unittest backend.scrapers.test_tga_lifecycle -v
"""

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from backend.scrapers.tga_scraper import TGAScraper

SRC = TGAScraper.SOURCE_ID


class _Query:
    """Just enough of the supabase-py query builder for BaseScraper."""

    def __init__(self, db, table):
        self.db, self.table, self.op = db, table, "select"
        self.filters, self.cols, self.count = [], "*", None
        self.patch, self.payload = None, None
        self.order_col, self.order_desc, self.rng, self.lim, self.one = None, False, None, None, False

    # builders
    def select(self, cols="*", count=None):
        self.cols, self.count = cols, count
        return self

    def update(self, patch):
        self.op, self.patch = "update", patch
        return self

    def upsert(self, payload, on_conflict=None):
        self.op, self.payload = "upsert", payload
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def eq(self, c, v):
        self.filters.append(lambda r: _get(r, c) == v)
        return self

    def in_(self, c, vs):
        vs = set(vs)
        self.filters.append(lambda r: _get(r, c) in vs)
        return self

    def gte(self, c, v):
        self.filters.append(lambda r: _get(r, c) is not None and _get(r, c) >= v)
        return self

    def order(self, c, desc=False):
        self.order_col, self.order_desc = c, desc
        return self

    def range(self, a, b):
        self.rng = (a, b)
        return self

    def limit(self, n):
        self.lim = n
        return self

    def single(self):
        self.one = True
        return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.op in ("upsert", "insert"):
            items = self.payload if isinstance(self.payload, list) else [self.payload]
            for it in items:
                hit = next((r for r in rows if self.op == "upsert"
                            and r.get("shortage_id") == it.get("shortage_id")), None)
                if hit:
                    hit.update(it)
                else:
                    rows.append({"id": str(uuid.uuid4()), **it})
            return SimpleNamespace(data=[rows[-1]], count=None)
        hits = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in hits:
                r.update(self.patch)
            self.db.updates.append((self.table, dict(self.patch), len(hits)))
            return SimpleNamespace(data=hits, count=None)
        if self.order_col:
            hits.sort(key=lambda r: r.get(self.order_col) or "", reverse=self.order_desc)
        n = len(hits)
        if self.rng:
            hits = hits[self.rng[0]:self.rng[1] + 1]
        if self.lim is not None:
            hits = hits[:self.lim]
        out = [_project(r, self.cols) for r in hits]
        if self.one:
            return SimpleNamespace(data=out[0] if out else None, count=n)
        return SimpleNamespace(data=out, count=n)


def _get(row, col):
    if "->>" in col:
        base, key = col.split("->>")
        v = (row.get(base) or {}).get(key)
        return None if v is None else str(v)
    return row.get(col)


def _project(row, cols):
    if cols.strip() == "*":
        return dict(row)
    out = {}
    for part in cols.split(","):
        part = part.strip()
        alias, _, expr = part.partition(":") if ":" in part else (part, "", part)
        out[alias] = _get(row, expr)
    return out


class FakeDB:
    def __init__(self):
        self.tables, self.updates = {}, []

    def table(self, name):
        return _Query(self, name)


def _iso(dt):
    return dt.isoformat()


def _row(artg, start, status, verified, sid=None):
    return {
        "id": str(uuid.uuid4()),
        "shortage_id": sid or f"old-{artg}-{start}",
        "drug_id": "drug-1",
        "data_source_id": SRC,
        "status": status,
        "severity": "low",
        "end_date": None,
        "start_date": start,
        "last_verified_at": verified,
        "raw_data": {"artg_numb": artg, "status": "A"},
    }


class CarryForwardTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.db.tables["drugs"] = [{"id": "drug-1", "generic_name_normalised": "dapsone"}]
        self.s = TGAScraper(db_client=self.db)

    def _event(self, artg, start_ddmmyyyy, status="A"):
        return self.s.normalize({"records": [{
            "active_ingredients": "dapsone", "artg_numb": artg, "trade_names": "X",
            "shortage_start": start_ddmmyyyy, "status": status,
            "availability": "Available",
        }]})

    def test_redated_anticipated_row_moves_forward(self):
        old = _row("111", "2027-01-15", "anticipated", "2026-10-01T00:00:00+00:00")
        self.db.tables["shortage_events"] = [old]
        counts = self.s.upsert(self._event("111", "15 Mar 2027"))
        rows = self.db.tables["shortage_events"]
        self.assertEqual(counts["carried_forward"], 1)
        self.assertEqual(len(rows), 1, "no second row beside the old one")
        self.assertEqual(rows[0]["id"], old["id"])
        self.assertEqual(rows[0]["start_date"], "2027-03-15")
        self.assertEqual(rows[0]["status"], "anticipated")

    def test_onset_reached_logs_anticipated_to_active(self):
        old = _row("222", "2026-09-01", "anticipated", "2026-10-01T00:00:00+00:00")
        self.db.tables["shortage_events"] = [old]
        self.s.upsert(self._event("222", "20 Oct 2026", status="C"))
        rows = self.db.tables["shortage_events"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["status"], "active")
        log = self.db.tables["shortage_status_log"]
        self.assertEqual((log[0]["old_status"], log[0]["new_status"]), ("anticipated", "active"))

    def test_existing_row_for_new_start_is_not_overwritten(self):
        sid = self.s._shortage_id("drug-1", "2027-03-15", "333")
        old = _row("333", "2027-01-15", "anticipated", "2026-10-01T00:00:00+00:00")
        cur = _row("333", "2027-03-15", "anticipated", "2026-10-01T00:00:00+00:00", sid=sid)
        self.db.tables["shortage_events"] = [old, cur]
        counts = self.s.upsert(self._event("333", "15 Mar 2027"))
        self.assertEqual(counts["carried_forward"], 0)
        self.assertEqual(old["start_date"], "2027-01-15", "superseded row left for mark_stale")

    def test_stale_and_resolved_rows_are_not_moved(self):
        stale = _row("444", "2025-01-01", "stale", "2026-01-01T00:00:00+00:00")
        done = _row("444", "2025-06-01", "resolved", "2026-01-01T00:00:00+00:00")
        self.db.tables["shortage_events"] = [stale, done]
        counts = self.s.upsert(self._event("444", "15 Mar 2027"))
        self.assertEqual(counts["carried_forward"], 0)
        self.assertEqual(len(self.db.tables["shortage_events"]), 3)

    def test_latest_of_several_open_rows_moves(self):
        a = _row("555", "2026-11-01", "anticipated", "2026-10-01T00:00:00+00:00")
        b = _row("555", "2026-12-01", "anticipated", "2026-10-01T00:00:00+00:00")
        self.db.tables["shortage_events"] = [a, b]
        self.s.upsert(self._event("555", "15 Mar 2027"))
        self.assertEqual(b["start_date"], "2027-03-15")
        self.assertEqual(a["start_date"], "2026-11-01")


class DuplicatePayloadTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.s = TGAScraper(db_client=self.db)
        self.payload = {"records": []}
        self.s.fetch = lambda: self.payload
        now = datetime.now(timezone.utc)
        self.last_run = now - timedelta(days=1)
        self.db.tables["raw_scrapes"] = [{
            "id": "rs-1", "data_source_id": SRC, "status": "processed",
            "content_hash": self.s._content_hash(self.payload),
            "scraped_at": _iso(self.last_run), "processing_started_at": _iso(self.last_run),
        }]
        self.in_feed = _row("1", "2026-01-01", "anticipated", _iso(self.last_run + timedelta(minutes=1)))
        self.orphan = _row("2", "2025-01-01", "active", _iso(now - timedelta(days=5)))
        self.db.tables["shortage_events"] = [self.in_feed, self.orphan]

    def test_refreshes_only_rows_of_unchanged_payload(self):
        orphan_verified = self.orphan["last_verified_at"]
        summary = self.s.run()
        self.assertEqual(summary["status"], "duplicate")
        self.assertGreater(self.in_feed["last_verified_at"], _iso(self.last_run + timedelta(minutes=1)))
        self.assertEqual(self.orphan["last_verified_at"], orphan_verified)
        self.assertFalse(any("status" in p for t, p, n in self.db.updates if t == "shortage_events"))

    def test_stale_row_of_payload_reprocesses_instead_of_reactivating(self):
        self.in_feed["status"] = "stale"
        reprocessed = []
        self.s.normalize = lambda raw: reprocessed.append(raw) or []
        summary = self.s.run()
        self.assertEqual(len(reprocessed), 1)
        self.assertNotEqual(summary["status"], "duplicate")
        self.assertEqual(self.in_feed["status"], "stale", "never blanket-set to active")

    def test_payload_matching_an_older_run_is_not_a_duplicate(self):
        later = self.last_run + timedelta(hours=12)
        self.db.tables["raw_scrapes"].append({
            "id": "rs-2", "data_source_id": SRC, "status": "processed",
            "content_hash": "something-else",
            "scraped_at": _iso(later), "processing_started_at": _iso(later),
        })
        self.s.normalize = lambda raw: []
        summary = self.s.run()
        self.assertNotEqual(summary["status"], "duplicate")


if __name__ == "__main__":
    unittest.main()
