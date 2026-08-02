"""LedgerService — the Activity tab's feed.

The service graph is real over fakes (no mocks), so the CASH legs these
tests assert on are the ones CashService genuinely writes, not a fixture's
guess at their shape.
"""

from datetime import UTC, datetime
from decimal import Decimal

from myapp.domain.model import (
    Account,
    AccountType,
    AssetClass,
    Instrument,
    Transaction,
    TransactionType,
)
from myapp.service.account_service import AccountService
from myapp.service.cash_service import CASH_INSTRUMENT_ID, CashService
from myapp.service.gains_service import GainsService
from myapp.service.instrument_service import InstrumentService
from myapp.service.ledger_service import LedgerService
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
    def __init__(self, *, accounts: list[Account] | None = None) -> None:
        instrument_repo = FakeInstrumentRepository([GOOG, TSLA])
        account_repo = FakeAccountRepository(
            list(accounts) if accounts is not None else [BROKERAGE, IRA]
        )
        transaction_repo = FakeTransactionRepository()

        transaction_service = TransactionService(
            transaction_repo=transaction_repo,
            account_repo=account_repo,
            instrument_repo=instrument_repo,
        )
        instrument_service = InstrumentService(repo=instrument_repo)
        self.cash_service = CashService(
            transaction_service=transaction_service,
            instrument_service=instrument_service,
        )
        self.service = LedgerService(
            account_service=AccountService(repo=account_repo),
            instrument_service=instrument_service,
            transaction_service=transaction_service,
            gains_service=GainsService(
                transaction_service=transaction_service,
                price_service=PriceService(
                    price_source=FakePriceSource(),
                    price_history_repo=FakePriceHistoryRepository(),
                    instrument_repo=instrument_repo,
                    clock=lambda: NOW,
                ),
            ),
        )

    def deposit(self, account_id: str, amount: str, *, id: str, day: int) -> None:
        self.cash_service.deposit(
            id=id,
            user_id="user-a",
            account_id=account_id,
            amount=Decimal(amount),
            timestamp=datetime(2026, 1, day),
        )

    def withdraw(self, account_id: str, amount: str, *, id: str, day: int) -> None:
        self.cash_service.withdraw(
            id=id,
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
        *,
        id: str,
        day: int,
    ) -> None:
        self.cash_service.log_trade(
            Transaction(
                id=id,
                user_id="user-a",
                account_id=account_id,
                instrument_id=instrument_id,
                type=kind,
                quantity=Decimal(quantity),
                price=Decimal(price),
                timestamp=datetime(2026, 1, day),
            )
        )

    def entry_ids(self, **kwargs) -> list[str]:
        return [
            e.transaction.id
            for e in self.service.list_entries(user_id="user-a", **kwargs)
        ]

    def by_id(self, **kwargs) -> dict[str, object]:
        return {
            e.transaction.id: e
            for e in self.service.list_entries(user_id="user-a", **kwargs)
        }


class TestPairedCashLegs:
    def test_a_trades_cash_leg_is_returned_carrying_the_trades_id(self) -> None:
        """The server ships the fact; Activity applies the rule.

        Filtering here would leave the client unable to tell a trade's cash
        leg from a genuine Deposit, and would push it towards re-deriving
        the pairing from account/timestamp/amount — the alternative
        docs/adr/0001-dashboard-v2.md § 2 rejected outright.
        """
        h = Harness()
        h.deposit("acc1", "10000", id="d1", day=1)
        h.trade("acc1", "goog", TransactionType.BUY, "10", "100", id="t1", day=2)

        entries = h.by_id()

        assert entries["t1-cash"].transaction.instrument_id == CASH_INSTRUMENT_ID
        assert entries["t1-cash"].transaction.trade_id == "t1"
        assert entries["t1"].transaction.trade_id == "t1"
        # The Deposit is the unpaired one, and that is the only thing
        # distinguishing it from the leg above.
        assert entries["d1"].transaction.trade_id is None

    def test_same_day_equal_amount_legs_are_distinguishable_only_by_trade_id(
        self,
    ) -> None:
        """A deposit and a trade's cash leg in the same account, on the same
        day, for the same amount, in the same direction — the collision any
        account/timestamp/amount matching would get wrong."""
        h = Harness()
        h.deposit("acc1", "5000", id="funding", day=1)
        # Sells 10 GOOG at 100 = 1000 proceeds, a CASH BUY of 1000...
        h.trade("acc1", "goog", TransactionType.BUY, "10", "100", id="open", day=1)
        h.trade("acc1", "goog", TransactionType.SELL, "10", "100", id="close", day=2)
        # ...and a genuine Deposit of exactly 1000 on the same day.
        h.deposit("acc1", "1000", id="topup", day=2)

        cash_rows = {
            e.transaction.id: e.transaction.trade_id
            for e in h.service.list_entries(user_id="user-a")
            if e.transaction.instrument_id == CASH_INSTRUMENT_ID
        }

        assert cash_rows == {
            "funding": None,
            "open-cash": "open",
            "close-cash": "close",
            "topup": None,
        }


class TestRealizedGain:
    def test_a_sell_carries_the_gain_it_booked(self) -> None:
        h = Harness()
        h.deposit("acc1", "10000", id="d1", day=1)
        h.trade("acc1", "goog", TransactionType.BUY, "10", "100", id="t1", day=2)
        h.trade("acc1", "goog", TransactionType.SELL, "4", "150", id="t2", day=3)

        entries = h.by_id()

        assert entries["t2"].realized_gain == Decimal("200")

    def test_a_buy_carries_no_gain_at_all(self) -> None:
        """None, not zero — opening a lot books nothing, and a 0 would read
        as "broke even" beside every purchase."""
        h = Harness()
        h.deposit("acc1", "10000", id="d1", day=1)
        h.trade("acc1", "goog", TransactionType.BUY, "10", "100", id="t1", day=2)

        assert h.by_id()["t1"].realized_gain is None

    def test_each_sell_reports_its_own_gain_not_the_positions_lifetime_total(
        self,
    ) -> None:
        h = Harness()
        h.deposit("acc1", "10000", id="d1", day=1)
        h.trade("acc1", "goog", TransactionType.BUY, "10", "100", id="t1", day=2)
        h.trade("acc1", "goog", TransactionType.SELL, "4", "150", id="t2", day=3)
        h.trade("acc1", "goog", TransactionType.SELL, "6", "120", id="t3", day=4)

        entries = h.by_id()

        assert entries["t2"].realized_gain == Decimal("200")
        assert entries["t3"].realized_gain == Decimal("120")

    def test_a_withdrawal_books_zero_because_cash_always_prices_at_one(self) -> None:
        h = Harness()
        h.deposit("acc1", "1000", id="d1", day=1)
        h.withdraw("acc1", "400", id="w1", day=2)

        assert h.by_id()["w1"].realized_gain == Decimal("0")


class TestOrderingAndScope:
    def test_entries_come_back_newest_first(self) -> None:
        h = Harness()
        h.deposit("acc1", "1000", id="d1", day=1)
        h.deposit("acc1", "2000", id="d2", day=5)
        h.deposit("acc1", "3000", id="d3", day=3)

        assert h.entry_ids() == ["d2", "d3", "d1"]

    def test_accounts_filter_narrows_the_feed(self) -> None:
        h = Harness()
        h.deposit("acc1", "1000", id="d1", day=1)
        h.deposit("acc2", "2000", id="d2", day=2)

        assert h.entry_ids(accounts=["acc2"]) == ["d2"]

    def test_instruments_filter_narrows_the_feed_including_its_cash_leg(self) -> None:
        """An instrument filter is about the traded instrument, so the
        paired CASH leg drops out with it — Activity would have hidden it
        anyway, and keeping it would put a stray cash row under a GOOG
        chip."""
        h = Harness()
        h.deposit("acc1", "10000", id="d1", day=1)
        h.trade("acc1", "goog", TransactionType.BUY, "10", "100", id="t1", day=2)
        h.trade("acc1", "tsla", TransactionType.BUY, "5", "200", id="t2", day=3)

        assert h.entry_ids(instruments=["goog"]) == ["t1"]

    def test_an_explicit_all_is_not_a_filter(self) -> None:
        h = Harness()
        h.deposit("acc1", "1000", id="d1", day=1)
        h.deposit("acc2", "2000", id="d2", day=2)

        assert h.entry_ids(accounts="all", instruments="all") == ["d2", "d1"]

    def test_an_unknown_id_is_intersected_away_rather_than_raising(self) -> None:
        h = Harness()
        h.deposit("acc1", "1000", id="d1", day=1)

        assert h.entry_ids(accounts=["nope"]) == []
        assert h.entry_ids(instruments=["nope"]) == []

    def test_another_users_ledger_is_never_returned(self) -> None:
        h = Harness(accounts=[BROKERAGE, OTHER_USERS])
        h.deposit("acc1", "1000", id="d1", day=1)

        assert h.service.list_entries(user_id="user-b") == []

    def test_an_empty_ledger_is_an_empty_list(self) -> None:
        assert Harness().service.list_entries(user_id="user-a") == []
