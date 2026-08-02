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
from myapp.domain.price import PriceBar
from myapp.service.cash_service import CASH_INSTRUMENT_ID, CashService
from myapp.service.gains_service import GainsService
from myapp.service.instrument_service import InstrumentService
from myapp.service.price_service import PriceService
from myapp.service.transaction_service import TransactionService
from tests.fake_price_source import FakePriceSource
from tests.fake_repository import (
    FakeAccountRepository,
    FakeInstrumentRepository,
    FakePriceHistoryRepository,
    FakeTransactionRepository,
)

ACCOUNT = Account(
    id="acc1",
    user_id="user-a",
    name="Brokerage",
    institution="Fidelity",
    account_type=AccountType.BROKERAGE,
)
GOOG = Instrument(
    id="goog", symbol="GOOG", name="Alphabet", asset_class=AssetClass.EQUITY
)
NOW = datetime(2026, 1, 10, 12, 0, tzinfo=UTC)


def _gains_service(
    *,
    accounts: list[Account] | None = None,
    instruments: list[Instrument] | None = None,
    transaction_repo: FakeTransactionRepository | None = None,
    price_source: FakePriceSource | None = None,
    price_history_repo: FakePriceHistoryRepository | None = None,
) -> tuple[GainsService, TransactionService, CashService]:
    instrument_repo = FakeInstrumentRepository(instruments or [GOOG])
    account_repo = FakeAccountRepository(accounts or [ACCOUNT])
    transaction_repo = transaction_repo or FakeTransactionRepository()

    transaction_service = TransactionService(
        transaction_repo=transaction_repo,
        account_repo=account_repo,
        instrument_repo=instrument_repo,
    )
    price_service = PriceService(
        price_source=price_source or FakePriceSource(),
        price_history_repo=price_history_repo or FakePriceHistoryRepository(),
        instrument_repo=instrument_repo,
        clock=lambda: NOW,
    )
    cash_service = CashService(
        transaction_service=transaction_service,
        instrument_service=InstrumentService(repo=instrument_repo),
    )
    gains_service = GainsService(
        transaction_service=transaction_service, price_service=price_service
    )
    return gains_service, transaction_service, cash_service


class TestRealizedGain:
    def test_sums_realized_gain_across_closed_lots(self) -> None:
        gains_service, transaction_service, _ = _gains_service()
        transaction_service.log_transaction(
            Transaction(
                id="t1",
                user_id="user-a",
                account_id="acc1",
                instrument_id="goog",
                type=TransactionType.BUY,
                quantity=Decimal("10"),
                price=Decimal("100"),
                timestamp=datetime(2026, 1, 1),
            )
        )
        transaction_service.log_transaction(
            Transaction(
                id="t2",
                user_id="user-a",
                account_id="acc1",
                instrument_id="goog",
                type=TransactionType.SELL,
                quantity=Decimal("4"),
                price=Decimal("150"),
                timestamp=datetime(2026, 1, 2),
            )
        )

        gain = gains_service.get_realized_gain("acc1", "goog", user_id="user-a")

        assert gain == Decimal("200")  # (150 - 100) * 4

    def test_returns_none_for_an_unowned_or_missing_account(self) -> None:
        gains_service, _, _ = _gains_service()

        assert (
            gains_service.get_realized_gain("acc1", "goog", user_id="someone-else")
            is None
        )

    def test_cash_instrument_realized_gain_is_always_zero(self) -> None:
        """The literal acceptance criterion: falls out of the shared FIFO
        math for free since every CASH transaction prices at exactly 1
        (see cash_service.py), not a special case in GainsService."""
        gains_service, _, cash_service = _gains_service()
        cash_service.deposit(
            id="t1",
            user_id="user-a",
            account_id="acc1",
            amount=Decimal("500"),
            timestamp=datetime(2026, 1, 1),
        )
        cash_service.withdraw(
            id="t2",
            user_id="user-a",
            account_id="acc1",
            amount=Decimal("200"),
            timestamp=datetime(2026, 1, 2),
        )

        gain = gains_service.get_realized_gain(
            "acc1", CASH_INSTRUMENT_ID, user_id="user-a"
        )

        assert gain == Decimal("0")


class TestRealizedGainByTransaction:
    """The per-sell attribution the Activity ledger renders. Distinct from
    the position's lifetime total above: three sells of one holding must
    each report what *that* sell booked."""

    def _buy(
        self, service: TransactionService, id: str, qty: str, price: str, day: int
    ) -> None:
        service.log_transaction(
            Transaction(
                id=id,
                user_id="user-a",
                account_id="acc1",
                instrument_id="goog",
                type=TransactionType.BUY,
                quantity=Decimal(qty),
                price=Decimal(price),
                timestamp=datetime(2026, 1, day),
            )
        )

    def _sell(
        self, service: TransactionService, id: str, qty: str, price: str, day: int
    ) -> None:
        service.log_transaction(
            Transaction(
                id=id,
                user_id="user-a",
                account_id="acc1",
                instrument_id="goog",
                type=TransactionType.SELL,
                quantity=Decimal(qty),
                price=Decimal(price),
                timestamp=datetime(2026, 1, day),
            )
        )

    def test_attributes_each_sell_its_own_gain(self) -> None:
        gains_service, transaction_service, _ = _gains_service()
        self._buy(transaction_service, "t1", "10", "100", day=1)
        self._sell(transaction_service, "t2", "4", "150", day=2)
        self._sell(transaction_service, "t3", "6", "120", day=3)

        by_transaction = gains_service.get_realized_gain_by_transaction(
            "acc1", "goog", user_id="user-a"
        )

        assert by_transaction == {
            "t2": Decimal("200"),  # (150 - 100) * 4
            "t3": Decimal("120"),  # (120 - 100) * 6
        }
        # And the lifetime figure is still their sum, so the two views of
        # the same lots cannot disagree.
        assert gains_service.get_realized_gain("acc1", "goog", user_id="user-a") == sum(
            by_transaction.values()
        )

    def test_a_sell_spanning_two_lots_reports_one_summed_figure(self) -> None:
        """FIFO closes as many lots as it needs to; the ledger shows one
        row per sell, so the per-lot events are folded together."""
        gains_service, transaction_service, _ = _gains_service()
        self._buy(transaction_service, "t1", "5", "100", day=1)
        self._buy(transaction_service, "t2", "5", "110", day=2)
        self._sell(transaction_service, "t3", "10", "150", day=3)

        by_transaction = gains_service.get_realized_gain_by_transaction(
            "acc1", "goog", user_id="user-a"
        )

        # (150 - 100) * 5 + (150 - 110) * 5
        assert by_transaction == {"t3": Decimal("450")}

    def test_a_position_with_no_sells_has_no_entries(self) -> None:
        gains_service, transaction_service, _ = _gains_service()
        self._buy(transaction_service, "t1", "10", "100", day=1)

        assert (
            gains_service.get_realized_gain_by_transaction(
                "acc1", "goog", user_id="user-a"
            )
            == {}
        )

    def test_returns_none_for_an_unowned_or_missing_account(self) -> None:
        gains_service, _, _ = _gains_service()

        assert (
            gains_service.get_realized_gain_by_transaction(
                "acc1", "goog", user_id="someone-else"
            )
            is None
        )


class TestUnrealizedGain:
    def test_uses_the_latest_fetched_market_price_on_open_lots(self) -> None:
        source = FakePriceSource(
            {"GOOG": [PriceBar(date=NOW.date(), close=Decimal("130"))]}
        )
        gains_service, transaction_service, _ = _gains_service(price_source=source)
        transaction_service.log_transaction(
            Transaction(
                id="t1",
                user_id="user-a",
                account_id="acc1",
                instrument_id="goog",
                type=TransactionType.BUY,
                quantity=Decimal("10"),
                price=Decimal("100"),
                timestamp=datetime(2026, 1, 1),
            )
        )

        gain = gains_service.get_unrealized_gain("acc1", "goog", user_id="user-a")

        assert gain == Decimal("300")  # (130 - 100) * 10

    def test_returns_zero_when_no_shares_are_held(self) -> None:
        gains_service, _, _ = _gains_service()

        gain = gains_service.get_unrealized_gain("acc1", "goog", user_id="user-a")

        assert gain == Decimal("0")

    def test_returns_none_when_no_price_data_is_available(self) -> None:
        gains_service, transaction_service, _ = _gains_service(
            price_source=FakePriceSource({"GOOG": []})
        )
        transaction_service.log_transaction(
            Transaction(
                id="t1",
                user_id="user-a",
                account_id="acc1",
                instrument_id="goog",
                type=TransactionType.BUY,
                quantity=Decimal("10"),
                price=Decimal("100"),
                timestamp=datetime(2026, 1, 1),
            )
        )

        assert (
            gains_service.get_unrealized_gain("acc1", "goog", user_id="user-a") is None
        )

    def test_returns_none_for_an_unowned_or_missing_account(self) -> None:
        gains_service, _, _ = _gains_service()

        assert (
            gains_service.get_unrealized_gain("acc1", "goog", user_id="someone-else")
            is None
        )

    def test_cash_instrument_unrealized_gain_uses_the_definitional_price_of_one(
        self,
    ) -> None:
        gains_service, _, cash_service = _gains_service()
        cash_service.deposit(
            id="t1",
            user_id="user-a",
            account_id="acc1",
            amount=Decimal("500"),
            timestamp=datetime(2026, 1, 1),
        )

        gain = gains_service.get_unrealized_gain(
            "acc1", CASH_INSTRUMENT_ID, user_id="user-a"
        )

        assert gain == Decimal("0")
