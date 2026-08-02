from datetime import datetime
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
from myapp.domain.position import InsufficientSharesError
from myapp.service.transaction_service import (
    AccountNotFoundError,
    InstrumentNotFoundError,
    TransactionService,
)
from tests.fake_repository import (
    FakeAccountRepository,
    FakeInstrumentRepository,
    FakeTransactionRepository,
)

ACCOUNT = Account(
    id="acc1",
    user_id="user-a",
    name="Brokerage",
    institution="Fidelity",
    account_type=AccountType.BROKERAGE,
)
INSTRUMENT = Instrument(
    id="goog", symbol="GOOG", name="Alphabet", asset_class=AssetClass.EQUITY
)


def _service(
    transactions: list[Transaction] | None = None,
) -> TransactionService:
    return TransactionService(
        transaction_repo=FakeTransactionRepository(transactions),
        account_repo=FakeAccountRepository([ACCOUNT]),
        instrument_repo=FakeInstrumentRepository([INSTRUMENT]),
    )


def _buy(quantity: str, price: str = "100") -> Transaction:
    return Transaction(
        id="t1",
        user_id="user-a",
        account_id="acc1",
        instrument_id="goog",
        type=TransactionType.BUY,
        quantity=Decimal(quantity),
        price=Decimal(price),
        timestamp=datetime(2026, 1, 1),
    )


class TestLogTransaction:
    def test_logs_a_buy_and_it_appears_in_the_position(self) -> None:
        service = _service()

        service.log_transaction(_buy("10"))

        position = service.get_position("acc1", "goog", user_id="user-a")
        assert position is not None
        assert position.share_count == Decimal("10")

    def test_rejects_a_sell_that_exceeds_holdings(self) -> None:
        service = _service([_buy("5")])
        sell = Transaction(
            id="t2",
            user_id="user-a",
            account_id="acc1",
            instrument_id="goog",
            type=TransactionType.SELL,
            quantity=Decimal("10"),
            price=Decimal("200"),
            timestamp=datetime(2026, 1, 2),
        )

        with pytest.raises(InsufficientSharesError):
            service.log_transaction(sell)

    def test_rejects_a_transaction_against_a_nonexistent_account(self) -> None:
        service = _service()
        transaction = Transaction(
            id="t1",
            user_id="user-a",
            account_id="missing-account",
            instrument_id="goog",
            type=TransactionType.BUY,
            quantity=Decimal("1"),
            price=Decimal("100"),
            timestamp=datetime(2026, 1, 1),
        )

        with pytest.raises(AccountNotFoundError):
            service.log_transaction(transaction)

    def test_rejects_a_transaction_against_an_account_owned_by_another_user(
        self,
    ) -> None:
        """Cross-user account access must fail the same way a missing
        account does — no distinguishing signal for an attacker."""
        service = _service()
        transaction = Transaction(
            id="t1",
            user_id="user-b",
            account_id="acc1",  # owned by user-a
            instrument_id="goog",
            type=TransactionType.BUY,
            quantity=Decimal("1"),
            price=Decimal("100"),
            timestamp=datetime(2026, 1, 1),
        )

        with pytest.raises(AccountNotFoundError):
            service.log_transaction(transaction)

    def test_rejects_a_transaction_against_a_nonexistent_instrument(self) -> None:
        service = _service()
        transaction = Transaction(
            id="t1",
            user_id="user-a",
            account_id="acc1",
            instrument_id="missing-instrument",
            type=TransactionType.BUY,
            quantity=Decimal("1"),
            price=Decimal("100"),
            timestamp=datetime(2026, 1, 1),
        )

        with pytest.raises(InstrumentNotFoundError):
            service.log_transaction(transaction)


class TestGetPosition:
    def test_returns_none_for_an_account_owned_by_another_user(self) -> None:
        service = _service([_buy("10")])

        assert service.get_position("acc1", "goog", user_id="user-b") is None

    def test_returns_a_zero_position_when_never_traded(self) -> None:
        service = _service()

        position = service.get_position("acc1", "goog", user_id="user-a")

        assert position is not None
        assert position.share_count == Decimal("0")
