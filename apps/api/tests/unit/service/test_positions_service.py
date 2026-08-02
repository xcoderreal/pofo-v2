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
from myapp.service.account_service import AccountService
from myapp.service.cash_service import CASH_INSTRUMENT_ID, CashService
from myapp.service.gains_service import GainsService
from myapp.service.instrument_service import InstrumentService
from myapp.service.positions_service import PositionsService
from myapp.service.price_service import PriceService
from myapp.service.transaction_service import TransactionService
from tests.fake_price_source import FakePriceSource
from tests.fake_repository import (
    FakeAccountRepository,
    FakeInstrumentRepository,
    FakePriceHistoryRepository,
    FakeTransactionRepository,
)

NOW = datetime(2026, 1, 10, 12, 0, tzinfo=UTC)

BROKERAGE = Account(
    id="acc1",
    user_id="user-a",
    name="Brokerage",
    institution="Fidelity",
    account_type=AccountType.BROKERAGE,
)
IRA = Account(
    id="acc2",
    user_id="user-a",
    name="IRA",
    institution="Fidelity",
    account_type=AccountType.IRA,
)
OTHER_USERS = Account(
    id="acc9",
    user_id="user-b",
    name="Not yours",
    institution="Elsewhere",
    account_type=AccountType.BROKERAGE,
)
GOOG = Instrument(
    id="goog", symbol="GOOG", name="Alphabet", asset_class=AssetClass.EQUITY
)
TSLA = Instrument(id="tsla", symbol="TSLA", name="Tesla", asset_class=AssetClass.EQUITY)


class Harness:
    """The real service graph over fakes — no mocks, so interface drift in
    any of the four composed services fails here."""

    def __init__(
        self,
        *,
        accounts: list[Account],
        instruments: list[Instrument],
        prices: dict[str, list[PriceBar]] | None = None,
    ) -> None:
        instrument_repo = FakeInstrumentRepository(list(instruments))
        account_repo = FakeAccountRepository(list(accounts))
        transaction_repo = FakeTransactionRepository()

        self.transaction_service = TransactionService(
            transaction_repo=transaction_repo,
            account_repo=account_repo,
            instrument_repo=instrument_repo,
        )
        self.instrument_service = InstrumentService(repo=instrument_repo)
        price_service = PriceService(
            price_source=FakePriceSource(prices or {}),
            price_history_repo=FakePriceHistoryRepository(),
            instrument_repo=instrument_repo,
            clock=lambda: NOW,
        )
        self.cash_service = CashService(
            transaction_service=self.transaction_service,
            instrument_service=self.instrument_service,
        )
        self.service = PositionsService(
            account_service=AccountService(repo=account_repo),
            instrument_service=self.instrument_service,
            transaction_service=self.transaction_service,
            gains_service=GainsService(
                transaction_service=self.transaction_service,
                price_service=price_service,
            ),
            price_service=price_service,
        )

    def deposit(self, account_id: str, amount: str, day: int = 1) -> None:
        self.cash_service.deposit(
            id=f"dep-{account_id}-{day}",
            user_id="user-a",
            account_id=account_id,
            amount=Decimal(amount),
            timestamp=datetime(2026, 1, day),
        )

    def trade(
        self,
        account_id: str,
        instrument_id: str,
        kind: TransactionType,
        quantity: str,
        price: str,
        day: int,
    ) -> None:
        self.cash_service.log_trade(
            Transaction(
                id=f"{account_id}-{instrument_id}-{kind}-{day}",
                user_id="user-a",
                account_id=account_id,
                instrument_id=instrument_id,
                type=kind,
                quantity=Decimal(quantity),
                price=Decimal(price),
                timestamp=datetime(2026, 1, day),
            )
        )


@pytest.fixture
def harness() -> Harness:
    return Harness(
        accounts=[BROKERAGE, IRA, OTHER_USERS],
        instruments=[GOOG, TSLA],
        prices={"GOOG": [PriceBar(date=NOW.date(), close=Decimal("130"))]},
    )


def _by_key(rows) -> dict[tuple[str, str], object]:
    return {(r.account_id, r.instrument_id): r for r in rows}


class TestRowContents:
    def test_returns_every_documented_field_for_an_open_position(
        self, harness: Harness
    ) -> None:
        harness.deposit("acc1", "10000")
        harness.trade("acc1", "goog", TransactionType.BUY, "10", "100", day=2)

        row = _by_key(harness.service.list_positions(user_id="user-a"))[
            ("acc1", "goog")
        ]

        assert row.share_count == Decimal("10")
        assert row.cost_basis == Decimal("1000")
        assert row.average_cost == Decimal("100")
        assert row.market_value == Decimal("1300")  # 10 * 130
        assert row.realized_gain == Decimal("0")
        assert row.unrealized_gain == Decimal("300")  # 1300 - 1000

    def test_average_cost_blends_two_lots_at_different_prices(
        self, harness: Harness
    ) -> None:
        harness.deposit("acc1", "10000")
        harness.trade("acc1", "goog", TransactionType.BUY, "10", "100", day=2)
        harness.trade("acc1", "goog", TransactionType.BUY, "10", "140", day=3)

        row = _by_key(harness.service.list_positions(user_id="user-a"))[
            ("acc1", "goog")
        ]

        assert row.cost_basis == Decimal("2400")
        assert row.average_cost == Decimal("120")

    def test_market_value_and_unrealized_gain_are_none_without_price_history(
        self, harness: Harness
    ) -> None:
        """TSLA has no bars in the fake source. A None here is what lets
        the client show a pending state instead of a $0 holding."""
        harness.deposit("acc1", "10000")
        harness.trade("acc1", "tsla", TransactionType.BUY, "5", "200", day=2)

        row = _by_key(harness.service.list_positions(user_id="user-a"))[
            ("acc1", "tsla")
        ]

        assert row.share_count == Decimal("5")
        assert row.cost_basis == Decimal("1000")
        assert row.market_value is None
        assert row.unrealized_gain is None

    def test_cash_rows_are_included_and_priced_at_one(self, harness: Harness) -> None:
        """The Accounts list shows value *including* cash, so the CASH row
        has to come back from this endpoint — filtering it out of Holdings
        is the client's job."""
        harness.deposit("acc1", "10000")
        harness.trade("acc1", "goog", TransactionType.BUY, "10", "100", day=2)

        row = _by_key(harness.service.list_positions(user_id="user-a"))[
            ("acc1", CASH_INSTRUMENT_ID)
        ]

        assert row.share_count == Decimal("9000")  # 10000 deposited - 1000 spent
        assert row.market_value == Decimal("9000")
        assert row.realized_gain == Decimal("0")


class TestClosedPositions:
    def test_a_fully_closed_position_is_returned_with_its_realized_gain(
        self, harness: Harness
    ) -> None:
        harness.deposit("acc1", "10000")
        harness.trade("acc1", "tsla", TransactionType.BUY, "10", "100", day=2)
        harness.trade("acc1", "tsla", TransactionType.SELL, "10", "150", day=3)

        row = _by_key(harness.service.list_positions(user_id="user-a"))[
            ("acc1", "tsla")
        ]

        assert row.share_count == Decimal("0")
        assert row.cost_basis == Decimal("0")
        assert row.realized_gain == Decimal("500")

    def test_a_closed_position_has_no_average_cost_and_zero_market_value(
        self, harness: Harness
    ) -> None:
        """No shares means no average price paid — a fabricated 0 would
        read as one. Market value is zero by definition, and needs no
        price lookup, so a closed row renders before any fetch."""
        harness.deposit("acc1", "10000")
        harness.trade("acc1", "tsla", TransactionType.BUY, "10", "100", day=2)
        harness.trade("acc1", "tsla", TransactionType.SELL, "10", "150", day=3)

        row = _by_key(harness.service.list_positions(user_id="user-a"))[
            ("acc1", "tsla")
        ]

        assert row.average_cost is None
        assert row.market_value == Decimal("0")
        assert row.unrealized_gain == Decimal("0")


class TestScope:
    def test_pairs_with_no_transactions_are_omitted(self, harness: Harness) -> None:
        """Two accounts x three instruments (incl. CASH) is six possible
        rows; only the two actually traded come back."""
        harness.deposit("acc1", "10000")
        harness.trade("acc1", "goog", TransactionType.BUY, "10", "100", day=2)

        rows = harness.service.list_positions(user_id="user-a")

        assert set(_by_key(rows)) == {("acc1", "goog"), ("acc1", CASH_INSTRUMENT_ID)}

    def test_scopes_to_the_given_accounts(self, harness: Harness) -> None:
        harness.deposit("acc1", "10000")
        harness.deposit("acc2", "10000")
        harness.trade("acc1", "goog", TransactionType.BUY, "10", "100", day=2)
        harness.trade("acc2", "goog", TransactionType.BUY, "4", "100", day=2)

        rows = harness.service.list_positions(user_id="user-a", accounts=["acc2"])

        assert {r.account_id for r in rows} == {"acc2"}

    def test_scopes_to_the_given_instruments(self, harness: Harness) -> None:
        harness.deposit("acc1", "10000")
        harness.trade("acc1", "goog", TransactionType.BUY, "10", "100", day=2)

        rows = harness.service.list_positions(user_id="user-a", instruments=["goog"])

        assert {r.instrument_id for r in rows} == {"goog"}

    def test_an_explicit_all_is_the_same_as_omitting_the_scope(
        self, harness: Harness
    ) -> None:
        harness.deposit("acc1", "10000")
        harness.trade("acc1", "goog", TransactionType.BUY, "10", "100", day=2)

        assert harness.service.list_positions(
            user_id="user-a", accounts=["all"], instruments=["all"]
        ) == harness.service.list_positions(user_id="user-a")

    def test_another_users_account_is_never_returned(self, harness: Harness) -> None:
        harness.cash_service.deposit(
            id="dep-other",
            user_id="user-b",
            account_id="acc9",
            amount=Decimal("5000"),
            timestamp=datetime(2026, 1, 1),
        )
        harness.deposit("acc1", "10000")

        rows = harness.service.list_positions(user_id="user-a")

        assert {r.account_id for r in rows} == {"acc1"}

    def test_asking_for_an_unowned_account_narrows_to_nothing(
        self, harness: Harness
    ) -> None:
        """A stale client filter degrades to fewer rows, not an error —
        the same treatment query_service gives an unknown id."""
        harness.deposit("acc1", "10000")

        assert harness.service.list_positions(user_id="user-a", accounts=["acc9"]) == []

    def test_rows_come_back_in_a_deterministic_order(self, harness: Harness) -> None:
        harness.deposit("acc2", "10000")
        harness.deposit("acc1", "10000")
        harness.trade("acc2", "goog", TransactionType.BUY, "4", "100", day=2)
        harness.trade("acc1", "tsla", TransactionType.BUY, "4", "100", day=2)

        rows = harness.service.list_positions(user_id="user-a")

        assert [(r.account_id, r.instrument_id) for r in rows] == sorted(
            (r.account_id, r.instrument_id) for r in rows
        )
