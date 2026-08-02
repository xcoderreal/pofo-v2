from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from myapp.domain.model import AssetClass, Instrument
from myapp.domain.price import PriceBar
from myapp.service.price_service import InstrumentNotFoundError, PriceService
from tests.fake_price_source import FakePriceSource
from tests.fake_repository import FakeInstrumentRepository, FakePriceHistoryRepository

GOOG = Instrument(
    id="goog", symbol="GOOG", name="Alphabet", asset_class=AssetClass.EQUITY
)
BTC = Instrument(
    id="btc", symbol="BTC-USD", name="Bitcoin", asset_class=AssetClass.CRYPTO
)

D0 = date(2026, 1, 5)
D1 = date(2026, 1, 6)
D2 = date(2026, 1, 7)


def _service(
    price_source: FakePriceSource,
    instrument_repo: FakeInstrumentRepository | None = None,
    price_history_repo: FakePriceHistoryRepository | None = None,
    now: datetime | None = None,
) -> PriceService:
    # Wednesday, Jan 7 2026, noon Eastern (17:00 UTC) — comfortably within
    # US market hours by default, so tests only see off-hours behavior
    # when they explicitly ask for it via `now`.
    fixed_now = now or datetime(2026, 1, 7, 17, 0, tzinfo=UTC)
    return PriceService(
        price_source=price_source,
        price_history_repo=price_history_repo or FakePriceHistoryRepository(),
        instrument_repo=instrument_repo or FakeInstrumentRepository([GOOG, BTC]),
        clock=lambda: fixed_now,
    )


class TestGetPriceHistory:
    def test_fetches_from_the_source_when_nothing_is_cached(self) -> None:
        source = FakePriceSource(
            {
                "GOOG": [
                    PriceBar(date=D0, close=Decimal("100")),
                    PriceBar(date=D1, close=Decimal("101")),
                ]
            }
        )
        service = _service(source)

        bars = service.get_price_history("goog", D0, D1)

        assert [b.close for b in bars] == [Decimal("100"), Decimal("101")]
        assert len(source.calls) == 1

    def test_a_second_request_for_already_covered_data_makes_no_call(self) -> None:
        source = FakePriceSource(
            {
                "GOOG": [
                    PriceBar(date=D0, close=Decimal("100")),
                    PriceBar(date=D1, close=Decimal("101")),
                ]
            }
        )
        repo = FakePriceHistoryRepository()
        service = _service(source, price_history_repo=repo)

        service.get_price_history("goog", D0, D1)
        service.get_price_history("goog", D0, D1)

        assert len(source.calls) == 1

    def test_only_the_missing_gap_is_fetched(self) -> None:
        source = FakePriceSource(
            {
                "GOOG": [
                    PriceBar(date=D0, close=Decimal("100")),
                    PriceBar(date=D1, close=Decimal("101")),
                    PriceBar(date=D2, close=Decimal("102")),
                ]
            }
        )
        repo = FakePriceHistoryRepository()
        repo.add_bars("goog", [PriceBar(date=D0, close=Decimal("100"))])
        # Last fetch was long enough ago (equity, but within market hours at
        # the fixed `now`) that a fetch attempt is worth making.
        repo.set_last_fetched_at("goog", datetime(2020, 1, 1, tzinfo=UTC))
        service = _service(source, price_history_repo=repo)

        bars = service.get_price_history("goog", D0, D2)

        assert source.calls == [("GOOG", D1, D2)]
        assert [b.close for b in bars] == [
            Decimal("100"),
            Decimal("101"),
            Decimal("102"),
        ]

    def test_a_request_for_an_earlier_start_than_ever_cached_fetches_the_backward_gap(
        self,
    ) -> None:
        """The bug this guards against: if gap detection only ever looked
        at the latest cached date, requesting an earlier start than
        anything cached (e.g. a chart widening its range from 30 days to
        52 weeks) would silently return incomplete data with no fetch and
        no error."""
        source = FakePriceSource(
            {
                "GOOG": [
                    PriceBar(date=D0, close=Decimal("100")),
                    PriceBar(date=D1, close=Decimal("101")),
                ]
            }
        )
        repo = FakePriceHistoryRepository()
        # Only the later half was ever fetched.
        repo.add_bars("goog", [PriceBar(date=D1, close=Decimal("101"))])
        repo.set_last_fetched_at("goog", datetime(2020, 1, 1, tzinfo=UTC))
        service = _service(source, price_history_repo=repo)

        bars = service.get_price_history("goog", D0, D1)

        assert ("GOOG", D0, D0) in source.calls
        assert [b.close for b in bars] == [Decimal("100"), Decimal("101")]

    def test_backward_gap_fetch_is_not_gated_by_market_hours(self) -> None:
        """Historical bars are immutable once past — filling in an
        earlier-than-cached range isn't a freshness question, so it
        should be fetched even on a weekend."""
        source = FakePriceSource({"GOOG": [PriceBar(date=D0, close=Decimal("100"))]})
        repo = FakePriceHistoryRepository()
        repo.add_bars("goog", [PriceBar(date=D1, close=Decimal("101"))])
        repo.set_last_fetched_at("goog", datetime(2020, 1, 1, tzinfo=UTC))
        saturday = datetime(2026, 1, 10, 12, 0, tzinfo=UTC)
        service = _service(source, price_history_repo=repo, now=saturday)

        bars = service.get_price_history("goog", D0, D1)

        assert ("GOOG", D0, D0) in source.calls
        assert [b.close for b in bars] == [Decimal("100"), Decimal("101")]

    def test_no_fetch_when_outside_market_hours_even_with_a_real_gap(self) -> None:
        """Not the never-fetched-before case (that's always worth trying,
        regardless of day) — this is the repeat-poll case: already fetched
        once, a real gap still exists, but it's a weekend, so it's not
        worth attempting again yet."""
        source = FakePriceSource({"GOOG": [PriceBar(date=D2, close=Decimal("102"))]})
        repo = FakePriceHistoryRepository()
        repo.add_bars("goog", [PriceBar(date=D0, close=Decimal("100"))])
        repo.set_last_fetched_at("goog", datetime(2020, 1, 1, tzinfo=UTC))
        saturday = datetime(2026, 1, 10, 12, 0, tzinfo=UTC)
        service = _service(source, price_history_repo=repo, now=saturday)

        bars = service.get_price_history("goog", D0, D2)

        assert source.calls == []
        assert [b.close for b in bars] == [Decimal("100")]

    def test_crypto_ignores_market_hours(self) -> None:
        """Distinguishes crypto from equity's behavior — a non-null, stale
        last_fetched_at, so this exercises the staleness comparison itself,
        not the always-true never-fetched-before path."""
        source = FakePriceSource(
            {"BTC-USD": [PriceBar(date=D2, close=Decimal("50000"))]}
        )
        repo = FakePriceHistoryRepository()
        repo.add_bars("btc", [PriceBar(date=D0, close=Decimal("49000"))])
        repo.set_last_fetched_at("btc", datetime(2020, 1, 1, tzinfo=UTC))
        saturday = datetime(2026, 1, 10, 3, 0, tzinfo=UTC)
        service = _service(source, price_history_repo=repo, now=saturday)

        bars = service.get_price_history("btc", D0, D2)

        assert source.calls == [("BTC-USD", D1, D2)]
        assert [b.close for b in bars] == [Decimal("49000"), Decimal("50000")]

    def test_raises_for_an_unknown_instrument(self) -> None:
        service = _service(FakePriceSource())

        with pytest.raises(InstrumentNotFoundError):
            service.get_price_history("missing", D0, D2)

    def test_empty_fetch_result_still_records_the_attempt(self) -> None:
        """A symbol with no trading on the requested days (e.g. a weekend
        span) shouldn't be retried every single call within the TTL."""
        source = FakePriceSource({"GOOG": []})
        repo = FakePriceHistoryRepository()
        service = _service(source, price_history_repo=repo)

        service.get_price_history("goog", D0, D2)
        service.get_price_history("goog", D0, D2)

        assert len(source.calls) == 1


class TestGetLatestPrice:
    def test_returns_the_most_recent_cached_bar(self) -> None:
        source = FakePriceSource(
            {
                "GOOG": [
                    PriceBar(date=D0, close=Decimal("100")),
                    PriceBar(date=D2, close=Decimal("102")),
                ]
            }
        )
        service = _service(source)

        bar = service.get_latest_price("goog")

        assert bar is not None
        assert bar.close == Decimal("102")

    def test_returns_none_when_no_price_data_is_available(self) -> None:
        source = FakePriceSource({"GOOG": []})
        service = _service(source)

        assert service.get_latest_price("goog") is None

    def test_cash_is_always_priced_at_one_without_calling_the_source(self) -> None:
        """CASH's price is definitional, not a market fact — there's no
        real "USD" ticker to look up on yfinance, so this must never hit
        the PriceSource."""
        cash = Instrument(
            id="cash", symbol="USD", name="Cash", asset_class=AssetClass.CASH
        )
        source = FakePriceSource()
        service = _service(source, instrument_repo=FakeInstrumentRepository([cash]))

        bar = service.get_latest_price("cash")

        assert bar is not None
        assert bar.close == Decimal("1")
        assert source.calls == []

    def test_raises_for_an_unknown_instrument(self) -> None:
        service = _service(FakePriceSource())

        with pytest.raises(InstrumentNotFoundError):
            service.get_latest_price("missing")

    def test_returns_a_cached_bar_older_than_the_lookback_window(self) -> None:
        """The bug this guards against: get_latest_price used to filter
        to a hardcoded recent window before picking the last bar, so a
        real cached price older than that window (nothing newer ever
        fetched, e.g. a rarely-traded instrument, or a forward-gap fetch
        declined by the staleness policy) was silently treated as "no
        data" and returned None instead of the actual latest known
        price."""
        source = FakePriceSource({"GOOG": []})
        repo = FakePriceHistoryRepository()
        old_bar_date = D0 - (2 * (D2 - D0))  # well outside the lookback window
        repo.add_bars("goog", [PriceBar(date=old_bar_date, close=Decimal("77"))])
        repo.set_last_fetched_at("goog", datetime(2020, 1, 1, tzinfo=UTC))
        # Weekend + already fetched — no new fetch is worth attempting, so
        # nothing newer gets pulled in, but the old bar is still the truth.
        saturday = datetime(2026, 1, 10, 12, 0, tzinfo=UTC)
        service = _service(source, price_history_repo=repo, now=saturday)

        bar = service.get_latest_price("goog")

        assert bar is not None
        assert bar.close == Decimal("77")
