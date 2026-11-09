"""Tests for the /freshness upstream-staleness helpers (migration 076).

Run from the repo root (no pytest needed):
    python3 -m backend.scrapers.test_source_freshness
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from backend.scrapers.base_scraper import newest_source_date, record_source_freshness

TODAY = min(date.today(), datetime.now(timezone.utc).date())


def test_newest_source_date_ignores_run_date_defaults():
    # Scrapers that default a missing date to today must not look like an advance.
    recs = [
        {"start_date": (TODAY - timedelta(days=9)).isoformat()},
        {"start_date": TODAY.isoformat()},
        {"start_date": (TODAY + timedelta(days=40)).isoformat()},  # forward-dated notice
        {"end_date": (TODAY - timedelta(days=3)).isoformat() + "T10:00:00Z"},
        {"start_date": "not a date"},
        {"start_date": None},
    ]
    assert newest_source_date(recs, ("start_date", "end_date")) == TODAY - timedelta(days=3)


def test_newest_source_date_none_when_nothing_dated():
    assert newest_source_date([{"start_date": TODAY.isoformat()}, {}], ("start_date",)) is None


class _Log:
    def warning(self, *a, **k):
        self.warned = True


class _FakeDB:
    """Minimal stand-in for the supabase-py query builder chain."""

    def __init__(self, row):
        self.row = row
        self.patches: list[dict] = []
        self._patch = None

    def table(self, _):
        return self

    def select(self, *_):
        self._patch = None
        return self

    def update(self, patch):
        self._patch = patch
        return self

    def eq(self, *_):
        return self

    def single(self):
        return self

    def execute(self):
        if self._patch is not None:
            self.patches.append(self._patch)
            return type("R", (), {"data": [self._patch]})
        return type("R", (), {"data": self.row})


NOW = datetime(2026, 10, 26, 2, 0, tzinfo=timezone.utc)


def _run(row, **kw):
    db = _FakeDB(row)
    record_source_freshness(db, "src", finished_at=NOW, log=_Log(), **kw)
    return db.patches[-1]


def test_advance_resets_streak():
    p = _run({"newest_source_date": "2026-10-01", "newest_source_date_unchanged_runs": 5},
             status="success", observed=date(2026, 10, 20))
    assert p["newest_source_date"] == "2026-10-20"
    assert p["newest_source_date_unchanged_runs"] == 0
    assert p["newest_source_date_first_seen_at"] == NOW.isoformat()
    assert p["last_run_status"] == "success"


def test_first_observation_is_a_baseline_not_an_advance():
    p = _run({"newest_source_date": None, "newest_source_date_unchanged_runs": 0},
             status="success", observed=date(2026, 10, 20))
    assert p["newest_source_date"] == "2026-10-20"
    assert "newest_source_date_first_seen_at" not in p


def test_same_date_extends_streak():
    p = _run({"newest_source_date": "2026-10-20", "newest_source_date_unchanged_runs": 5},
             status="success", observed=date(2026, 10, 20))
    assert p["newest_source_date_unchanged_runs"] == 6
    assert "newest_source_date" not in p


def test_duplicate_payload_extends_streak():
    p = _run({"newest_source_date": "2026-10-20", "newest_source_date_unchanged_runs": 2},
             status="duplicate", observed=None, payload_unchanged=True)
    assert p["newest_source_date_unchanged_runs"] == 3


def test_failed_run_only_records_attempt():
    p = _run({"newest_source_date": "2026-10-20", "newest_source_date_unchanged_runs": 2},
             status="failed", observed=date(2026, 10, 25))
    assert p == {"last_run_at": NOW.isoformat(), "last_run_status": "failed"}


def test_no_dates_leaves_streak_alone():
    p = _run({"newest_source_date": "2026-10-20", "newest_source_date_unchanged_runs": 2},
             status="empty", observed=None)
    assert "newest_source_date_unchanged_runs" not in p


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"{len(tests)} passed")
