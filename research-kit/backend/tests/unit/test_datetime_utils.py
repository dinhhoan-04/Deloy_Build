from datetime import datetime, timezone, timedelta

from app.utils.datetime import to_utc_naive


def test_to_utc_naive_none():
    assert to_utc_naive(None) is None


def test_to_utc_naive_naive_kept():
    dt = datetime(2026, 5, 14, 10, 0, 0)
    assert to_utc_naive(dt) == dt


def test_to_utc_naive_aware_utc():
    dt = datetime(2026, 5, 14, 10, 0, 0, tzinfo=timezone.utc)
    out = to_utc_naive(dt)
    assert out == datetime(2026, 5, 14, 10, 0, 0)
    assert out.tzinfo is None


def test_to_utc_naive_aware_non_utc():
    plus7 = timezone(timedelta(hours=7))
    dt = datetime(2026, 5, 14, 10, 0, 0, tzinfo=plus7)
    out = to_utc_naive(dt)
    assert out == datetime(2026, 5, 14, 3, 0, 0)
    assert out.tzinfo is None

