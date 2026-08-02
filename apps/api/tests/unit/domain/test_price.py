from datetime import UTC, datetime, timedelta

from myapp.domain.model import AssetClass
from myapp.domain.price import is_fetch_worth_attempting, is_us_market_hours


def _eastern_naive_to_utc(year, month, day, hour, minute) -> datetime:
    """Eastern Standard Time (UTC-5) — fine for these fixed test dates,
    none of which land in a DST transition window."""
    return datetime(year, month, day, hour, minute, tzinfo=UTC) + timedelta(hours=5)


class TestIsUsMarketHours:
    def test_weekday_during_market_hours_is_open(self) -> None:
        # Wednesday, Jan 7 2026, 10:00 AM Eastern
        now = _eastern_naive_to_utc(2026, 1, 7, 10, 0)
        assert is_us_market_hours(now) is True

    def test_weekday_before_market_open_is_closed(self) -> None:
        now = _eastern_naive_to_utc(2026, 1, 7, 8, 0)
        assert is_us_market_hours(now) is False

    def test_weekday_after_market_close_is_closed(self) -> None:
        now = _eastern_naive_to_utc(2026, 1, 7, 17, 0)
        assert is_us_market_hours(now) is False

    def test_saturday_is_closed(self) -> None:
        # Jan 10 2026 is a Saturday
        now = _eastern_naive_to_utc(2026, 1, 10, 10, 0)
        assert is_us_market_hours(now) is False

    def test_sunday_is_closed(self) -> None:
        now = _eastern_naive_to_utc(2026, 1, 11, 10, 0)
        assert is_us_market_hours(now) is False

    def test_exact_open_boundary_is_open(self) -> None:
        now = _eastern_naive_to_utc(2026, 1, 7, 9, 30)
        assert is_us_market_hours(now) is True

    def test_exact_close_boundary_is_open(self) -> None:
        now = _eastern_naive_to_utc(2026, 1, 7, 16, 0)
        assert is_us_market_hours(now) is True


class TestIsFetchWorthAttempting:
    def test_never_fetched_before_is_always_worth_attempting(self) -> None:
        now = _eastern_naive_to_utc(2026, 1, 10, 3, 0)  # Saturday, off-hours
        assert is_fetch_worth_attempting(AssetClass.EQUITY, None, now) is True
        assert is_fetch_worth_attempting(AssetClass.CRYPTO, None, now) is True

    def test_equity_outside_market_hours_is_never_worth_attempting(self) -> None:
        last_fetched_at = _eastern_naive_to_utc(2020, 1, 1, 0, 0)  # ancient
        now = _eastern_naive_to_utc(2026, 1, 10, 10, 0)  # Saturday
        assert (
            is_fetch_worth_attempting(AssetClass.EQUITY, last_fetched_at, now) is False
        )

    def test_etf_follows_the_same_market_hours_rule_as_equity(self) -> None:
        last_fetched_at = _eastern_naive_to_utc(2020, 1, 1, 0, 0)
        now = _eastern_naive_to_utc(2026, 1, 10, 10, 0)  # Saturday
        assert is_fetch_worth_attempting(AssetClass.ETF, last_fetched_at, now) is False

    def test_equity_within_market_hours_but_recently_fetched_is_not_worth_it(
        self,
    ) -> None:
        now = _eastern_naive_to_utc(2026, 1, 7, 10, 10)
        last_fetched_at = now - timedelta(minutes=5)
        assert (
            is_fetch_worth_attempting(AssetClass.EQUITY, last_fetched_at, now) is False
        )

    def test_equity_within_market_hours_and_stale_is_worth_it(self) -> None:
        now = _eastern_naive_to_utc(2026, 1, 7, 10, 30)
        last_fetched_at = now - timedelta(minutes=20)
        assert (
            is_fetch_worth_attempting(AssetClass.EQUITY, last_fetched_at, now) is True
        )

    def test_crypto_ignores_market_hours(self) -> None:
        now = _eastern_naive_to_utc(2026, 1, 10, 3, 0)  # Saturday, 3 AM
        last_fetched_at = now - timedelta(minutes=20)
        assert (
            is_fetch_worth_attempting(AssetClass.CRYPTO, last_fetched_at, now) is True
        )

    def test_crypto_recently_fetched_is_not_worth_it(self) -> None:
        now = _eastern_naive_to_utc(2026, 1, 10, 3, 0)
        last_fetched_at = now - timedelta(minutes=5)
        assert (
            is_fetch_worth_attempting(AssetClass.CRYPTO, last_fetched_at, now) is False
        )
