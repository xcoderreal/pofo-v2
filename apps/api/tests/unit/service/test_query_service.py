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
