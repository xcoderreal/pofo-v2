from datetime import UTC, datetime
from decimal import Decimal

import pytest

from myapp.domain.model import (
    Account,
    AccountType,
    AssetClass,
    Instrument,
    Transaction,
    TransactionType,
)
from myapp.domain.price import PriceBar
from myapp.domain.query import Granularity, GroupBy, Metric, Mode
from myapp.service.cash_service import CASH_INSTRUMENT_ID, CASH_SYMBOL
from myapp.service.price_service import PriceService
from myapp.service.query_service import (
    AccountsNotApplicableError,
    InstrumentsNotApplicableError,
    InvalidMetricModeError,
    QueryService,
)
from tests.fake_price_source import FakePriceSource
from tests.fake_repository import (
    FakeAccountRepository,
    FakeInstrumentRepository,
    FakePriceHistoryRepository,
    FakeTransactionRepository,
)

D = lambda y, m, d: datetime(y, m, d).date()  # noqa: E731

ACCOUNT_1 = Account(
    id="acc1",
    user_id="user-a",
    name="Brokerage",
    institution="Fidelity",
    account_type=AccountType.BROKERAGE,
)
ACCOUNT_2 = Account(
    id="acc2",
    user_id="user-a",
    name="IRA",
    institution="Fidelity",
    account_type=AccountType.IRA,
)
GOOG = Instrument(
    id="goog", symbol="GOOG", name="Alphabet", asset_class=AssetClass.EQUITY
)
AAPL = Instrument(id="aapl", symbol="AAPL", name="Apple", asset_class=AssetClass.EQUITY)
CASH = Instrument(
    id=CASH_INSTRUMENT_ID, symbol=CASH_SYMBOL, name="Cash", asset_class=AssetClass.CASH
)
NOW = datetime(2026, 6, 1, tzinfo=UTC)


def _buy(id, account_id, instrument_id, quantity, price, when) -> Transaction:
    return Transaction(
        id=id,
        user_id="user-a",
        account_id=account_id,
        instrument_id=instrument_id,
        type=TransactionType.BUY,
        quantity=Decimal(quantity),
        price=Decimal(price),
        timestamp=datetime(*when),
    )


def _sell(id, account_id, instrument_id, quantity, price, when) -> Transaction:
    return Transaction(
        id=id,
        user_id="user-a",
        account_id=account_id,
        instrument_id=instrument_id,
        type=TransactionType.SELL,
        quantity=Decimal(quantity),
        price=Decimal(price),
        timestamp=datetime(*when),
    )


def _service(
    *,
    accounts=None,
    instruments=None,
    transactions=None,
    price_source=None,
    price_history_repo=None,
) -> QueryService:
    instrument_repo = FakeInstrumentRepository(instruments or [GOOG, AAPL, CASH])
    account_repo = FakeAccountRepository(accounts or [ACCOUNT_1, ACCOUNT_2])
    transaction_repo = FakeTransactionRepository(transactions or [])
    price_service = PriceService(
        price_source=price_source or FakePriceSource(),
        price_history_repo=price_history_repo or FakePriceHistoryRepository(),
        instrument_repo=instrument_repo,
        clock=lambda: NOW,
    )
    return QueryService(
        account_repo=account_repo,
        instrument_repo=instrument_repo,
        transaction_repo=transaction_repo,
        price_service=price_service,
    )


class TestValidityTable:
    def test_rejects_point_in_time_for_realized_gain(self) -> None:
        service = _service()

        with pytest.raises(InvalidMetricModeError):
            service.query_timeseries(
                user_id="user-a",
                metric=Metric.REALIZED_GAIN,
                instruments="all",
                accounts="all",
                group_by=GroupBy.NONE,
                start=D(2026, 1, 1),
                end=D(2026, 1, 31),
                granularity=Granularity.DAILY,
                mode=Mode.POINT_IN_TIME,
            )

    def test_rejects_cumulative_for_a_level_metric(self) -> None:
        service = _service()

        with pytest.raises(InvalidMetricModeError):
            service.query_timeseries(
                user_id="user-a",
                metric=Metric.SHARE_COUNT,
                instruments="all",
                accounts="all",
                group_by=GroupBy.NONE,
                start=D(2026, 1, 1),
                end=D(2026, 1, 31),
                granularity=Granularity.DAILY,
                mode=Mode.CUMULATIVE,
            )

    def test_accepts_point_in_time_for_a_level_metric(self) -> None:
        service = _service()

        service.query_timeseries(
            user_id="user-a",
            metric=Metric.SHARE_COUNT,
            instruments="all",
            accounts="all",
            group_by=GroupBy.NONE,
            start=D(2026, 1, 1),
            end=D(2026, 1, 31),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )  # does not raise


class TestMarketPriceAccountRejection:
    def test_rejects_an_explicit_accounts_scope(self) -> None:
        service = _service()

        with pytest.raises(AccountsNotApplicableError):
            service.query_timeseries(
                user_id="user-a",
                metric=Metric.MARKET_PRICE,
                instruments="all",
                accounts=["acc1"],
                group_by=GroupBy.NONE,
                start=D(2026, 1, 1),
                end=D(2026, 1, 31),
                granularity=Granularity.DAILY,
                mode=Mode.POINT_IN_TIME,
            )

    def test_rejects_group_by_account(self) -> None:
        service = _service()

        with pytest.raises(AccountsNotApplicableError):
            service.query_timeseries(
                user_id="user-a",
                metric=Metric.MARKET_PRICE,
                instruments="all",
                accounts=None,
                group_by=GroupBy.ACCOUNT,
                start=D(2026, 1, 1),
                end=D(2026, 1, 31),
                granularity=Granularity.DAILY,
                mode=Mode.POINT_IN_TIME,
            )

    def test_accepts_when_accounts_is_omitted(self) -> None:
        service = _service()

        service.query_timeseries(
            user_id="user-a",
            metric=Metric.MARKET_PRICE,
            instruments=["goog"],
            accounts=None,
            group_by=GroupBy.NONE,
            start=D(2026, 1, 1),
            end=D(2026, 1, 31),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )  # does not raise

    def test_accepts_an_explicit_all_accounts_since_it_narrows_nothing(self) -> None:
        service = _service()

        service.query_timeseries(
            user_id="user-a",
            metric=Metric.MARKET_PRICE,
            instruments=["goog"],
            accounts="all",
            group_by=GroupBy.NONE,
            start=D(2026, 1, 1),
            end=D(2026, 1, 31),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )  # does not raise — "all" is a no-op, unlike a concrete list


class TestPrimitiveMetrics:
    def test_share_count_point_in_time(self) -> None:
        transactions = [_buy("t1", "acc1", "goog", "10", "100", (2026, 1, 5))]
        service = _service(transactions=transactions)

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.SHARE_COUNT,
            instruments=["goog"],
            accounts=["acc1"],
            group_by=GroupBy.NONE,
            start=D(2026, 1, 1),
            end=D(2026, 1, 10),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        assert len(result) == 1
        values = {p.timestamp: p.value for p in result[0].points}
        assert D(2026, 1, 4) not in values  # before first activity — sparse
        assert values[D(2026, 1, 5)] == Decimal("10")
        assert values[D(2026, 1, 10)] == Decimal("10")

    def test_no_points_before_first_activity(self) -> None:
        """Sparse: nothing before the account's first transaction, not a
        long run of zero-padding."""
        transactions = [_buy("t1", "acc1", "goog", "10", "100", (2026, 1, 20))]
        service = _service(transactions=transactions)

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.SHARE_COUNT,
            instruments=["goog"],
            accounts=["acc1"],
            group_by=GroupBy.NONE,
            start=D(2026, 1, 1),
            end=D(2026, 1, 10),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        assert result == []

    def test_cost_basis_point_in_time(self) -> None:
        transactions = [
            _buy("t1", "acc1", "goog", "10", "100", (2026, 1, 1)),
            _sell("t2", "acc1", "goog", "4", "150", (2026, 1, 5)),
        ]
        service = _service(transactions=transactions)

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.COST_BASIS,
            instruments=["goog"],
            accounts=["acc1"],
            group_by=GroupBy.NONE,
            start=D(2026, 1, 1),
            end=D(2026, 1, 10),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        values = {p.timestamp: p.value for p in result[0].points}
        assert values[D(2026, 1, 1)] == Decimal("1000")
        assert values[D(2026, 1, 5)] == Decimal("600")  # 6 remaining @ 100

    def test_market_price_is_a_raw_pass_through_of_stored_bars(self) -> None:
        source = FakePriceSource(
            {
                "GOOG": [
                    PriceBar(date=D(2026, 1, 2), close=Decimal("100")),
                    PriceBar(date=D(2026, 1, 6), close=Decimal("105")),
                ]
            }
        )
        service = _service(price_source=source)

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.MARKET_PRICE,
            instruments=["goog"],
            accounts=None,
            group_by=GroupBy.NONE,
            start=D(2026, 1, 1),
            end=D(2026, 1, 10),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        values = {p.timestamp: p.value for p in result[0].points}
        assert values == {
            D(2026, 1, 2): Decimal("100"),
            D(2026, 1, 6): Decimal("105"),
        }  # sparse — no point on days with no real bar

    def test_market_price_resamples_to_the_last_bar_per_period(self) -> None:
        source = FakePriceSource(
            {
                "GOOG": [
                    PriceBar(date=D(2026, 1, 2), close=Decimal("100")),
                    PriceBar(date=D(2026, 1, 3), close=Decimal("101")),
                    PriceBar(date=D(2026, 2, 4), close=Decimal("110")),
                ]
            }
        )
        service = _service(price_source=source)

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.MARKET_PRICE,
            instruments=["goog"],
            accounts=None,
            group_by=GroupBy.NONE,
            start=D(2026, 1, 1),
            end=D(2026, 2, 28),
            granularity=Granularity.MONTHLY,
            mode=Mode.POINT_IN_TIME,
        )

        values = {p.timestamp: p.value for p in result[0].points}
        # boundaries step from `start` (Jan 1) by whole months: Jan 1, Feb
        # 1, Feb 28 (end) — so the Jan 2/3 bars resample onto the Feb 1
        # boundary (the end of that first period), and the Feb 4 bar onto
        # the final Feb 28 boundary.
        assert values[D(2026, 2, 1)] == Decimal("101")
        assert values[D(2026, 2, 28)] == Decimal("110")
        assert D(2026, 1, 1) not in values  # no bar in [., Jan 1] — sparse

    def test_realized_gain_delta_per_period(self) -> None:
        transactions = [
            _buy("t1", "acc1", "goog", "10", "100", (2026, 1, 1)),
            _sell("t2", "acc1", "goog", "4", "150", (2026, 1, 15)),
            _sell("t3", "acc1", "goog", "6", "80", (2026, 2, 15)),
        ]
        service = _service(transactions=transactions)

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.REALIZED_GAIN,
            instruments=["goog"],
            accounts=["acc1"],
            group_by=GroupBy.NONE,
            start=D(2026, 1, 1),
            end=D(2026, 2, 28),
            granularity=Granularity.MONTHLY,
            mode=Mode.DELTA_PER_PERIOD,
        )

        values = {p.timestamp: p.value for p in result[0].points}
        # boundaries step from `start` (Jan 1) by whole months: Jan 1, Feb
        # 1, Feb 28 (end) — the Jan 15 close falls in the (Jan 1, Feb 1]
        # period, the Feb 15 close in the (Feb 1, Feb 28] period.
        assert values[D(2026, 2, 1)] == Decimal("200")  # (150-100)*4
        assert values[D(2026, 2, 28)] == Decimal("-120")  # (80-100)*6

    def test_realized_gain_cumulative(self) -> None:
        transactions = [
            _buy("t1", "acc1", "goog", "10", "100", (2026, 1, 1)),
            _sell("t2", "acc1", "goog", "4", "150", (2026, 1, 15)),
            _sell("t3", "acc1", "goog", "6", "80", (2026, 2, 15)),
        ]
        service = _service(transactions=transactions)

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.REALIZED_GAIN,
            instruments=["goog"],
            accounts=["acc1"],
            group_by=GroupBy.NONE,
            start=D(2026, 1, 1),
            end=D(2026, 2, 28),
            granularity=Granularity.MONTHLY,
            mode=Mode.CUMULATIVE,
        )

        values = {p.timestamp: p.value for p in result[0].points}
        assert values[D(2026, 2, 1)] == Decimal("200")
        assert values[D(2026, 2, 28)] == Decimal("80")  # 200 + (-120)

    def test_realized_gain_has_no_points_when_nothing_ever_closed(self) -> None:
        transactions = [_buy("t1", "acc1", "goog", "10", "100", (2026, 1, 1))]
        service = _service(transactions=transactions)

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.REALIZED_GAIN,
            instruments=["goog"],
            accounts=["acc1"],
            group_by=GroupBy.NONE,
            start=D(2026, 1, 1),
            end=D(2026, 2, 28),
            granularity=Granularity.MONTHLY,
            mode=Mode.DELTA_PER_PERIOD,
        )

        assert result == []


class TestCompositeMetrics:
    def test_equity_is_share_count_times_market_price(self) -> None:
        transactions = [_buy("t1", "acc1", "goog", "10", "100", (2026, 1, 1))]
        source = FakePriceSource(
            {"GOOG": [PriceBar(date=D(2026, 1, 5), close=Decimal("120"))]}
        )
        service = _service(transactions=transactions, price_source=source)

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.EQUITY,
            instruments=["goog"],
            accounts=["acc1"],
            group_by=GroupBy.NONE,
            start=D(2026, 1, 1),
            end=D(2026, 1, 10),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        values = {p.timestamp: p.value for p in result[0].points}
        assert values[D(2026, 1, 5)] == Decimal("1200")  # 10 * 120
        assert D(2026, 1, 1) not in values  # no price bar yet — sparse

    def test_unrealized_gain_is_equity_minus_cost_basis(self) -> None:
        transactions = [_buy("t1", "acc1", "goog", "10", "100", (2026, 1, 1))]
        source = FakePriceSource(
            {"GOOG": [PriceBar(date=D(2026, 1, 5), close=Decimal("120"))]}
        )
        service = _service(transactions=transactions, price_source=source)

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.UNREALIZED_GAIN,
            instruments=["goog"],
            accounts=["acc1"],
            group_by=GroupBy.NONE,
            start=D(2026, 1, 1),
            end=D(2026, 1, 10),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        values = {p.timestamp: p.value for p in result[0].points}
        assert values[D(2026, 1, 5)] == Decimal("200")  # 1200 equity - 1000 basis


class TestRangeStartOnANonTradingDay:
    """A range very often starts on a weekend or a holiday. Without a
    backward lookback the first boundary has no bar and is dropped, so
    every range-scoped comparison silently measures from the first
    trading day instead of from the range start — which is what the
    Holdings/Accounts row percentages are defined against (#16)."""

    def test_the_first_boundary_uses_the_last_close_before_it(self) -> None:
        # Jan 3 2026 is a Saturday; the last close is Jan 2.
        transactions = [_buy("t1", "acc1", "goog", "10", "100", (2025, 12, 1))]
        source = FakePriceSource(
            {
                "GOOG": [
                    PriceBar(date=D(2026, 1, 2), close=Decimal("120")),
                    PriceBar(date=D(2026, 1, 5), close=Decimal("130")),
                ]
            }
        )
        service = _service(transactions=transactions, price_source=source)

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.EQUITY,
            instruments=["goog"],
            accounts=["acc1"],
            group_by=GroupBy.NONE,
            start=D(2026, 1, 3),
            end=D(2026, 1, 10),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        values = {p.timestamp: p.value for p in result[0].points}
        assert values[D(2026, 1, 3)] == Decimal("1200")  # 10 * Jan 2's close

    def test_an_interior_gap_is_still_never_padded(self) -> None:
        """The lookback only ever feeds the first boundary — every
        interior boundary's candidate window is bounded below by the
        previous one, so a real mid-range gap stays sparse."""
        transactions = [_buy("t1", "acc1", "goog", "10", "100", (2025, 12, 1))]
        source = FakePriceSource(
            {"GOOG": [PriceBar(date=D(2026, 1, 2), close=Decimal("120"))]}
        )
        service = _service(transactions=transactions, price_source=source)

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.EQUITY,
            instruments=["goog"],
            accounts=["acc1"],
            group_by=GroupBy.NONE,
            start=D(2026, 1, 3),
            end=D(2026, 1, 6),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        assert [p.timestamp for p in result[0].points] == [D(2026, 1, 3)]

    def test_a_position_opened_after_the_range_start_still_starts_late(self) -> None:
        """The lookback must not resurrect a position that didn't exist
        yet — that distinction is what renders a dash rather than a
        fabricated percentage in the Holdings list."""
        transactions = [_buy("t1", "acc1", "goog", "10", "100", (2026, 1, 5))]
        source = FakePriceSource(
            {
                "GOOG": [
                    PriceBar(date=D(2026, 1, 2), close=Decimal("120")),
                    PriceBar(date=D(2026, 1, 5), close=Decimal("130")),
                ]
            }
        )
        service = _service(transactions=transactions, price_source=source)

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.EQUITY,
            instruments=["goog"],
            accounts=["acc1"],
            group_by=GroupBy.NONE,
            start=D(2026, 1, 3),
            end=D(2026, 1, 10),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        assert [p.timestamp for p in result[0].points] == [D(2026, 1, 5)]

    def test_repeating_the_same_query_does_not_repeat_the_upstream_fetch(self) -> None:
        """The bug this guards against: reaching back seven days from
        `start` puts the requested window permanently below the earliest
        bar that exists, so the price cache can never "close" that gap.
        With the backward fetch keyed on cached data alone, three
        identical dashboard loads issued one, two and three upstream
        fetches — unbounded growth, per (account, instrument) pair, from a
        screen that is simply being re-rendered."""
        transactions = [_buy("t1", "acc1", "goog", "10", "100", (2025, 12, 1))]
        source = FakePriceSource(
            {
                "GOOG": [
                    PriceBar(date=D(2026, 1, 2), close=Decimal("120")),
                    PriceBar(date=D(2026, 1, 5), close=Decimal("130")),
                ]
            }
        )
        service = _service(transactions=transactions, price_source=source)

        for _ in range(3):
            result = service.query_timeseries(
                user_id="user-a",
                metric=Metric.EQUITY,
                instruments=["goog"],
                accounts=["acc1"],
                group_by=GroupBy.NONE,
                start=D(2026, 1, 3),
                end=D(2026, 1, 10),
                granularity=Granularity.DAILY,
                mode=Mode.POINT_IN_TIME,
            )

        assert len(source.calls) == 1
        # And the answer is unchanged — the fix is about not re-asking,
        # not about asking for less.
        values = {p.timestamp: p.value for p in result[0].points}
        assert values[D(2026, 1, 3)] == Decimal("1200")


class TestCashBalance:
    def test_always_targets_cash_when_instruments_is_omitted_or_all(self) -> None:
        transactions = [
            _buy("t1", "acc1", CASH_INSTRUMENT_ID, "500", "1", (2026, 1, 1)),
            _buy("t2", "acc1", "goog", "10", "100", (2026, 1, 2)),
        ]
        service = _service(transactions=transactions)

        for instruments in (None, "all", ["all"]):
            result = service.query_timeseries(
                user_id="user-a",
                metric=Metric.CASH_BALANCE,
                instruments=instruments,
                accounts=["acc1"],
                group_by=GroupBy.NONE,
                start=D(2026, 1, 1),
                end=D(2026, 1, 10),
                granularity=Granularity.DAILY,
                mode=Mode.POINT_IN_TIME,
            )

            values = {p.timestamp: p.value for p in result[0].points}
            assert values[D(2026, 1, 1)] == Decimal("500")

    def test_rejects_an_explicit_instruments_filter(self) -> None:
        service = _service()

        with pytest.raises(InstrumentsNotApplicableError):
            service.query_timeseries(
                user_id="user-a",
                metric=Metric.CASH_BALANCE,
                instruments=["goog"],
                accounts=["acc1"],
                group_by=GroupBy.NONE,
                start=D(2026, 1, 1),
                end=D(2026, 1, 10),
                granularity=Granularity.DAILY,
                mode=Mode.POINT_IN_TIME,
            )


class TestGroupBy:
    def test_group_by_none_sums_across_every_matched_pair(self) -> None:
        transactions = [
            _buy("t1", "acc1", "goog", "10", "100", (2026, 1, 1)),
            _buy("t2", "acc2", "goog", "5", "100", (2026, 1, 1)),
        ]
        service = _service(transactions=transactions)

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.SHARE_COUNT,
            instruments=["goog"],
            accounts="all",
            group_by=GroupBy.NONE,
            start=D(2026, 1, 1),
            end=D(2026, 1, 1),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        assert len(result) == 1
        assert result[0].group == "total"
        assert result[0].points[0].value == Decimal("15")

    def test_group_by_instrument_combines_across_accounts(self) -> None:
        transactions = [
            _buy("t1", "acc1", "goog", "10", "100", (2026, 1, 1)),
            _buy("t2", "acc2", "goog", "5", "100", (2026, 1, 1)),
            _buy("t3", "acc1", "aapl", "3", "50", (2026, 1, 1)),
        ]
        service = _service(transactions=transactions)

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.SHARE_COUNT,
            instruments="all",
            accounts="all",
            group_by=GroupBy.INSTRUMENT,
            start=D(2026, 1, 1),
            end=D(2026, 1, 1),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        by_group = {s.group: s.points[0].value for s in result}
        assert by_group == {"goog": Decimal("15"), "aapl": Decimal("3")}

    def test_group_by_account_combines_across_instruments(self) -> None:
        transactions = [
            _buy("t1", "acc1", "goog", "10", "100", (2026, 1, 1)),
            _buy("t2", "acc1", "aapl", "3", "50", (2026, 1, 1)),
            _buy("t3", "acc2", "goog", "5", "100", (2026, 1, 1)),
        ]
        service = _service(transactions=transactions)

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.SHARE_COUNT,
            instruments="all",
            accounts="all",
            group_by=GroupBy.ACCOUNT,
            start=D(2026, 1, 1),
            end=D(2026, 1, 1),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        by_group = {s.group: s.points[0].value for s in result}
        assert by_group == {"acc1": Decimal("13"), "acc2": Decimal("5")}


class TestScopeResolution:
    def test_accounts_all_resolves_to_every_account_the_user_owns(self) -> None:
        other_user_account = Account(
            id="acc3",
            user_id="someone-else",
            name="Not mine",
            institution="X",
            account_type=AccountType.BROKERAGE,
        )
        transactions = [
            _buy("t1", "acc1", "goog", "10", "100", (2026, 1, 1)),
            _buy("t2", "acc3", "goog", "999", "1", (2026, 1, 1)),
        ]
        service = _service(
            accounts=[ACCOUNT_1, ACCOUNT_2, other_user_account],
            transactions=transactions,
        )

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.SHARE_COUNT,
            instruments=["goog"],
            accounts="all",
            group_by=GroupBy.INSTRUMENT,
            start=D(2026, 1, 1),
            end=D(2026, 1, 1),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        # only acc1's 10 shares count — acc3 isn't owned by user-a
        assert result[0].points[0].value == Decimal("10")

    def test_an_unowned_explicit_account_id_is_silently_dropped(self) -> None:
        service = _service(transactions=[])

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.SHARE_COUNT,
            instruments=["goog"],
            accounts=["someone-elses-account"],
            group_by=GroupBy.NONE,
            start=D(2026, 1, 1),
            end=D(2026, 1, 1),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        assert result == []


class TestAllScopeExcludesCashForDollarMetrics:
    """equity/cost_basis/unrealized_gain summed across "all" instruments
    would otherwise double-count: a dollar spent buying GOOG has already
    left the CASH position (CashService.log_trade's paired leg), so
    adding CASH's dollar balance back into a portfolio-wide equity total
    counts it twice. share_count/cash_balance/market_price are unaffected
    — the double-counting problem is specific to summed dollar totals."""

    def _funded_goog_transactions(self) -> list[Transaction]:
        return [
            _buy("t1", "acc1", CASH_INSTRUMENT_ID, "10000", "1", (2026, 1, 1)),
            _buy("t2", "acc1", "goog", "10", "100", (2026, 1, 2)),
        ]

    def test_equity_all_scope_excludes_cash(self) -> None:
        source = FakePriceSource(
            {"GOOG": [PriceBar(date=D(2026, 1, 5), close=Decimal("120"))]}
        )
        service = _service(
            transactions=self._funded_goog_transactions(), price_source=source
        )

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.EQUITY,
            instruments="all",
            accounts=["acc1"],
            group_by=GroupBy.INSTRUMENT,
            start=D(2026, 1, 1),
            end=D(2026, 1, 10),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        groups = {s.group for s in result}
        assert groups == {"goog"}  # no "cash" group at all

    def test_cost_basis_all_scope_excludes_cash(self) -> None:
        service = _service(transactions=self._funded_goog_transactions())

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.COST_BASIS,
            instruments="all",
            accounts=["acc1"],
            group_by=GroupBy.INSTRUMENT,
            start=D(2026, 1, 1),
            end=D(2026, 1, 10),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        groups = {s.group for s in result}
        assert groups == {"goog"}

    def test_unrealized_gain_all_scope_excludes_cash(self) -> None:
        source = FakePriceSource(
            {"GOOG": [PriceBar(date=D(2026, 1, 5), close=Decimal("120"))]}
        )
        service = _service(
            transactions=self._funded_goog_transactions(), price_source=source
        )

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.UNREALIZED_GAIN,
            instruments="all",
            accounts=["acc1"],
            group_by=GroupBy.INSTRUMENT,
            start=D(2026, 1, 1),
            end=D(2026, 1, 10),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        groups = {s.group for s in result}
        assert groups == {"goog"}

    def test_share_count_all_scope_still_includes_cash(self) -> None:
        """The exclusion is specific to summed-dollar metrics — a
        breakdown by instrument has no double-counting problem."""
        service = _service(transactions=self._funded_goog_transactions())

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.SHARE_COUNT,
            instruments="all",
            accounts=["acc1"],
            group_by=GroupBy.INSTRUMENT,
            start=D(2026, 1, 1),
            end=D(2026, 1, 10),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        groups = {s.group for s in result}
        assert groups == {"goog", CASH_INSTRUMENT_ID}

    def test_an_explicit_cash_request_for_equity_is_still_honored(self) -> None:
        """The exclusion only narrows what "all" expands to — an
        explicit ask for CASH's own equity is still a well-defined,
        answerable query (trivially == cash_balance, since price is
        always 1)."""
        service = _service(transactions=self._funded_goog_transactions())

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.EQUITY,
            instruments=[CASH_INSTRUMENT_ID],
            accounts=["acc1"],
            group_by=GroupBy.NONE,
            start=D(2026, 1, 1),
            end=D(2026, 1, 1),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        assert result[0].points[0].value == Decimal("10000")


BTC = Instrument(id="btc", symbol="BTC", name="Bitcoin", asset_class=AssetClass.CRYPTO)


class TestCombiningSparseSeries:
    """A group's contributing series are sparse *independently* — a price
    metric is only sampled at boundaries where that instrument has a bar,
    and every pair starts at its own first transaction. Reading an absent
    sample as zero turns the group total into a partial sum over whichever
    series happened to have a bar there."""

    def test_a_level_series_missing_the_final_boundary_is_carried_forward(
        self,
    ) -> None:
        # The reported repro (#20): Feb 1 2026 is a Sunday. The equity
        # holding has no bar, crypto does — so the whole-portfolio total
        # collapsed to the crypto holding alone on the last point, and
        # the headline change figure is computed against that point.
        transactions = [
            _buy("t1", "acc1", "goog", "10", "100", (2026, 1, 1)),
            _buy("t2", "acc1", "btc", "2", "1000", (2026, 1, 1)),
        ]
        source = FakePriceSource(
            {
                "GOOG": [PriceBar(date=D(2026, 1, 30), close=Decimal("120"))],
                "BTC": [
                    PriceBar(date=D(2026, 1, 30), close=Decimal("1100")),
                    PriceBar(date=D(2026, 2, 1), close=Decimal("1200")),
                ],
            }
        )
        service = _service(
            instruments=[GOOG, BTC, CASH],
            transactions=transactions,
            price_source=source,
        )

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.EQUITY,
            instruments="all",
            accounts="all",
            group_by=GroupBy.NONE,
            start=D(2026, 1, 30),
            end=D(2026, 2, 1),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        values = {p.timestamp: p.value for p in result[0].points}
        assert values[D(2026, 1, 30)] == Decimal("3400")  # 1200 GOOG + 2200 BTC
        # GOOG has no Sunday bar. It is still worth Friday's close — it did
        # not become worthless because the market was shut.
        assert values[D(2026, 2, 1)] == Decimal("3600")  # 1200 GOOG + 2400 BTC

    def test_no_boundary_is_invented_that_no_series_sampled(self) -> None:
        """Carrying a value onto a boundary the group *already* emits is
        not gap-padding (behaviour.md § Chart): Jan 31 is sampled by
        neither series and must stay absent."""
        transactions = [
            _buy("t1", "acc1", "goog", "10", "100", (2026, 1, 1)),
            _buy("t2", "acc1", "btc", "2", "1000", (2026, 1, 1)),
        ]
        source = FakePriceSource(
            {
                "GOOG": [PriceBar(date=D(2026, 1, 30), close=Decimal("120"))],
                "BTC": [
                    PriceBar(date=D(2026, 1, 30), close=Decimal("1100")),
                    PriceBar(date=D(2026, 2, 1), close=Decimal("1200")),
                ],
            }
        )
        service = _service(
            instruments=[GOOG, BTC, CASH],
            transactions=transactions,
            price_source=source,
        )

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.EQUITY,
            instruments="all",
            accounts="all",
            group_by=GroupBy.NONE,
            start=D(2026, 1, 30),
            end=D(2026, 2, 1),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        assert [p.timestamp for p in result[0].points] == [
            D(2026, 1, 30),
            D(2026, 2, 1),
        ]

    def test_a_series_contributes_zero_before_its_own_first_sample(self) -> None:
        """A position that did not exist yet contributes nothing —
        carrying its value *backwards* would fabricate history, and the
        range-start sample is exactly the denominator every range-scoped
        percentage is defined against (behaviour.md § Percentages)."""
        transactions = [
            _buy("t1", "acc1", "goog", "10", "100", (2026, 1, 1)),
            _buy("t2", "acc1", "aapl", "3", "50", (2026, 2, 1)),
        ]
        source = FakePriceSource(
            {
                "GOOG": [
                    PriceBar(date=D(2026, 1, 1), close=Decimal("100")),
                    PriceBar(date=D(2026, 2, 1), close=Decimal("120")),
                ],
                "AAPL": [PriceBar(date=D(2026, 2, 1), close=Decimal("50"))],
            }
        )
        service = _service(transactions=transactions, price_source=source)

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.EQUITY,
            instruments="all",
            accounts="all",
            group_by=GroupBy.NONE,
            start=D(2026, 1, 1),
            end=D(2026, 2, 1),
            granularity=Granularity.MONTHLY,
            mode=Mode.POINT_IN_TIME,
        )

        values = {p.timestamp: p.value for p in result[0].points}
        assert values[D(2026, 1, 1)] == Decimal("1000")  # GOOG alone — no AAPL yet
        assert values[D(2026, 2, 1)] == Decimal("1350")  # 1200 + 150

    def test_group_by_account_carries_each_accounts_holdings_forward(self) -> None:
        """The Grid's per-account sparklines hit the same boundary: an
        account holding only equities must not read as zero on a day the
        market was shut."""
        transactions = [
            _buy("t1", "acc1", "goog", "10", "100", (2026, 1, 1)),
            _buy("t2", "acc1", "btc", "2", "1000", (2026, 1, 1)),
        ]
        source = FakePriceSource(
            {
                "GOOG": [PriceBar(date=D(2026, 1, 30), close=Decimal("120"))],
                "BTC": [
                    PriceBar(date=D(2026, 1, 30), close=Decimal("1100")),
                    PriceBar(date=D(2026, 2, 1), close=Decimal("1200")),
                ],
            }
        )
        service = _service(
            instruments=[GOOG, BTC, CASH],
            transactions=transactions,
            price_source=source,
        )

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.EQUITY,
            instruments="all",
            accounts="all",
            group_by=GroupBy.ACCOUNT,
            start=D(2026, 1, 30),
            end=D(2026, 2, 1),
            granularity=Granularity.DAILY,
            mode=Mode.POINT_IN_TIME,
        )

        values = {p.timestamp: p.value for p in result[0].points}
        assert values[D(2026, 2, 1)] == Decimal("3600")

    def test_a_per_period_flow_reads_an_absent_bucket_as_zero(self) -> None:
        """realized_gain in delta_per_period is a Flow: the gain booked
        *within* that bucket. A bucket with no sale earned nothing —
        carrying the previous bucket's gain forward would book it twice."""
        transactions = [
            _buy("t1", "acc1", "goog", "10", "100", (2026, 1, 1)),
            _sell("t2", "acc1", "goog", "10", "150", (2026, 1, 15)),
            _buy("t3", "acc1", "aapl", "10", "50", (2026, 1, 1)),
            _sell("t4", "acc1", "aapl", "10", "60", (2026, 2, 15)),
        ]
        service = _service(transactions=transactions)

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.REALIZED_GAIN,
            instruments="all",
            accounts="all",
            group_by=GroupBy.NONE,
            start=D(2026, 1, 1),
            end=D(2026, 3, 1),
            granularity=Granularity.MONTHLY,
            mode=Mode.DELTA_PER_PERIOD,
        )

        values = {p.timestamp: p.value for p in result[0].points}
        # GOOG booked 500 in the January bucket, AAPL 100 in February.
        assert values[D(2026, 2, 1)] == Decimal("500")
        assert values[D(2026, 3, 1)] == Decimal("100")

    def test_a_cumulative_flow_is_a_running_total_and_sums_across_groups(self) -> None:
        transactions = [
            _buy("t1", "acc1", "goog", "10", "100", (2026, 1, 1)),
            _sell("t2", "acc1", "goog", "10", "150", (2026, 1, 15)),
            _buy("t3", "acc1", "aapl", "10", "50", (2026, 1, 1)),
            _sell("t4", "acc1", "aapl", "10", "60", (2026, 2, 15)),
        ]
        service = _service(transactions=transactions)

        result = service.query_timeseries(
            user_id="user-a",
            metric=Metric.REALIZED_GAIN,
            instruments="all",
            accounts="all",
            group_by=GroupBy.NONE,
            start=D(2026, 1, 1),
            end=D(2026, 3, 1),
            granularity=Granularity.MONTHLY,
            mode=Mode.CUMULATIVE,
        )

        values = {p.timestamp: p.value for p in result[0].points}
        assert values[D(2026, 2, 1)] == Decimal("500")
        assert values[D(2026, 3, 1)] == Decimal("600")  # 500 + 100
