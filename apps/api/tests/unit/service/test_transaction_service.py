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


def _sell(
    quantity: str, price: str = "100", instrument_id: str = "goog"
) -> Transaction:
    return Transaction(
        id="t2",
        user_id="user-a",
        account_id="acc1",
        instrument_id=instrument_id,
        type=TransactionType.SELL,
        quantity=Decimal(quantity),
        price=Decimal(price),
        timestamp=datetime(2026, 1, 2),
    )


class TestLogTransactions:
    """The batch primitive log_transaction is a thin wrapper over — each
    transaction validates independently against its own (account,
    instrument) ledger, and the whole batch persists atomically (all or
    nothing). This is what lets a caller (e.g. CashService, pairing a
    trade with its cash leg) log two transactions for different
    instruments as a single unit."""

    def test_logs_multiple_transactions_for_different_instruments_atomically(
        self,
    ) -> None:
        instrument_repo = FakeInstrumentRepository(
            [
                INSTRUMENT,
                Instrument(
                    id="cash", symbol="USD", name="Cash", asset_class=AssetClass.CASH
                ),
            ]
        )
        existing_deposit = Transaction(
            id="deposit1",
            user_id="user-a",
            account_id="acc1",
            instrument_id="cash",
            type=TransactionType.BUY,
            quantity=Decimal("5000"),
            price=Decimal("1"),
            timestamp=datetime(2025, 12, 31),
        )
        service = TransactionService(
            transaction_repo=FakeTransactionRepository([existing_deposit]),
            account_repo=FakeAccountRepository([ACCOUNT]),
            instrument_repo=instrument_repo,
        )
        goog_buy = _buy("10")  # $1000 @ $100
        cash_sell = _sell("1000", price="1", instrument_id="cash")  # pays for it

        result = service.log_transactions([goog_buy, cash_sell])

        assert result == [goog_buy, cash_sell]
        assert service.get_position("acc1", "goog", user_id="user-a").share_count == (
            Decimal("10")
        )
        assert service.get_position("acc1", "cash", user_id="user-a").share_count == (
            Decimal("4000")
        )

    def test_a_failure_in_one_transaction_persists_neither(self) -> None:
        """Atomicity: if the SECOND transaction in the batch is invalid,
        the first must not have been written either — otherwise a trade
        could end up with its instrument leg logged but its cash leg
        silently dropped."""
        instrument_repo = FakeInstrumentRepository(
            [
                INSTRUMENT,
                Instrument(
                    id="cash", symbol="USD", name="Cash", asset_class=AssetClass.CASH
                ),
            ]
        )
        transaction_repo = FakeTransactionRepository()
        service = TransactionService(
            transaction_repo=transaction_repo,
            account_repo=FakeAccountRepository([ACCOUNT]),
            instrument_repo=instrument_repo,
        )
        goog_buy = _buy("10")
        # Overdraws cash — nothing has ever been deposited.
        invalid_cash_sell = _sell("1000000", price="1", instrument_id="cash")

        with pytest.raises(InsufficientSharesError):
            service.log_transactions([goog_buy, invalid_cash_sell])

        assert transaction_repo.list_by_account_instrument("acc1", "goog") == []

    def test_log_transaction_is_a_single_item_batch(self) -> None:
        service = _service()

        result = service.log_transaction(_buy("10"))

        assert result == _buy("10")
        assert service.get_position("acc1", "goog", user_id="user-a").share_count == (
            Decimal("10")
        )


class TestGetPosition:
    def test_returns_none_for_an_account_owned_by_another_user(self) -> None:
        service = _service([_buy("10")])

        assert service.get_position("acc1", "goog", user_id="user-b") is None

    def test_returns_a_zero_position_when_never_traded(self) -> None:
        service = _service()

        position = service.get_position("acc1", "goog", user_id="user-a")

        assert position is not None
        assert position.share_count == Decimal("0")
