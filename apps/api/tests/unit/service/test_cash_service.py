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
from myapp.service.cash_service import CASH_INSTRUMENT_ID, CASH_SYMBOL, CashService
from myapp.service.instrument_service import DuplicateSymbolError, InstrumentService
from myapp.service.transaction_service import TransactionService
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


def _cash_service(
    instrument_repo: FakeInstrumentRepository | None = None,
) -> CashService:
    instrument_repo = instrument_repo or FakeInstrumentRepository()
    transaction_service = TransactionService(
        transaction_repo=FakeTransactionRepository(),
        account_repo=FakeAccountRepository([ACCOUNT]),
        instrument_repo=instrument_repo,
    )
    return CashService(
        transaction_service=transaction_service,
        instrument_service=InstrumentService(repo=instrument_repo),
    )


class TestDeposit:
    def test_deposit_auto_provisions_the_cash_instrument(self) -> None:
        instrument_repo = FakeInstrumentRepository()
        service = _cash_service(instrument_repo)

        service.deposit(
            id="t1",
            user_id="user-a",
            account_id="acc1",
            amount=Decimal("500"),
            timestamp=datetime(2026, 1, 1),
        )

        cash = instrument_repo.get(CASH_INSTRUMENT_ID)
        assert cash is not None
        assert cash.symbol == CASH_SYMBOL
        assert cash.asset_class == AssetClass.CASH

    def test_deposit_does_not_duplicate_the_cash_instrument_on_repeat_deposits(
        self,
    ) -> None:
        instrument_repo = FakeInstrumentRepository()
        service = _cash_service(instrument_repo)

        service.deposit(
            id="t1",
            user_id="user-a",
            account_id="acc1",
            amount=Decimal("100"),
            timestamp=datetime(2026, 1, 1),
        )
        service.deposit(
            id="t2",
            user_id="user-a",
            account_id="acc1",
            amount=Decimal("200"),
            timestamp=datetime(2026, 1, 2),
        )

        assert len(instrument_repo.list_all()) == 1

    def test_deposit_surfaces_a_conflict_if_usd_already_exists_under_another_id(
        self,
    ) -> None:
        """The behavioral point of routing auto-provisioning through
        InstrumentService instead of writing to the repo directly: a
        pre-existing "USD" instrument under some other id is a genuine
        naming conflict that must surface, not silently coexist with a
        second CASH-like row."""
        instrument_repo = FakeInstrumentRepository(
            [
                Instrument(
                    id="user-created-usd",
                    symbol=CASH_SYMBOL,
                    name="Someone's USD entry",
                    asset_class=AssetClass.CASH,
                )
            ]
        )
        service = _cash_service(instrument_repo)

        with pytest.raises(DuplicateSymbolError):
            service.deposit(
                id="t1",
                user_id="user-a",
                account_id="acc1",
                amount=Decimal("100"),
                timestamp=datetime(2026, 1, 1),
            )

    def test_deposit_increases_cash_balance(self) -> None:
        service = _cash_service()

        service.deposit(
            id="t1",
            user_id="user-a",
            account_id="acc1",
            amount=Decimal("500"),
            timestamp=datetime(2026, 1, 1),
        )

        balance = service.transaction_service.get_position(
            "acc1", CASH_INSTRUMENT_ID, user_id="user-a"
        )
        assert balance is not None
        assert balance.share_count == Decimal("500")

    def test_cost_basis_equals_share_count_for_a_cash_position(self) -> None:
        """The literal acceptance criterion, not just its price==1
        mechanism — asserted directly on Position, not inferred."""
        service = _cash_service()
        service.deposit(
            id="t1",
            user_id="user-a",
            account_id="acc1",
            amount=Decimal("500"),
            timestamp=datetime(2026, 1, 1),
        )
        service.deposit(
            id="t2",
            user_id="user-a",
            account_id="acc1",
            amount=Decimal("250"),
            timestamp=datetime(2026, 1, 2),
        )

        balance = service.transaction_service.get_position(
            "acc1", CASH_INSTRUMENT_ID, user_id="user-a"
        )

        assert balance is not None
        assert balance.cost_basis == balance.share_count == Decimal("750")

    def test_deposit_transaction_is_always_priced_at_one(self) -> None:
        """The mechanism that makes cost_basis == share_count and
        realized_gain == 0 fall out of the shared FIFO math for free,
        rather than being special-cased: every CASH transaction prices
        at exactly 1, so opening and closing price are always equal."""
        instrument_repo = FakeInstrumentRepository()
        transaction_repo = FakeTransactionRepository()
        service = CashService(
            transaction_service=TransactionService(
                transaction_repo=transaction_repo,
                account_repo=FakeAccountRepository([ACCOUNT]),
                instrument_repo=instrument_repo,
            ),
            instrument_service=InstrumentService(repo=instrument_repo),
        )

        service.deposit(
            id="t1",
            user_id="user-a",
            account_id="acc1",
            amount=Decimal("500"),
            timestamp=datetime(2026, 1, 1),
        )

        transactions = transaction_repo.list_by_account_instrument(
            "acc1", CASH_INSTRUMENT_ID
        )
        assert all(t.price == Decimal(1) for t in transactions)


class TestWithdraw:
    def test_withdraw_decreases_cash_balance(self) -> None:
        service = _cash_service()
        service.deposit(
            id="t1",
            user_id="user-a",
            account_id="acc1",
            amount=Decimal("500"),
            timestamp=datetime(2026, 1, 1),
        )

        service.withdraw(
            id="t2",
            user_id="user-a",
            account_id="acc1",
            amount=Decimal("200"),
            timestamp=datetime(2026, 1, 2),
        )

        balance = service.transaction_service.get_position(
            "acc1", CASH_INSTRUMENT_ID, user_id="user-a"
        )
        assert balance is not None
        assert balance.share_count == Decimal("300")

    def test_withdraw_more_than_the_balance_is_rejected(self) -> None:
        service = _cash_service()
        service.deposit(
            id="t1",
            user_id="user-a",
            account_id="acc1",
            amount=Decimal("100"),
            timestamp=datetime(2026, 1, 1),
        )

        with pytest.raises(InsufficientSharesError):
            service.withdraw(
                id="t2",
                user_id="user-a",
                account_id="acc1",
                amount=Decimal("200"),
                timestamp=datetime(2026, 1, 2),
            )


class TestCashAlongsideOrdinaryInstrumentTrades:
    def test_buying_an_instrument_does_not_affect_cash_balance(self) -> None:
        """Cash and instrument positions are independent Position
        computations over the same ledger — a stock buy has no automatic
        cash-leg side effect (that's computed elsewhere, not by this
        ticket's scope). Confirms the two don't cross-contaminate."""
        instrument_repo = FakeInstrumentRepository(
            [
                Instrument(
                    id="goog",
                    symbol="GOOG",
                    name="Alphabet",
                    asset_class=AssetClass.EQUITY,
                )
            ]
        )
        service = _cash_service(instrument_repo)
        service.deposit(
            id="t1",
            user_id="user-a",
            account_id="acc1",
            amount=Decimal("1000"),
            timestamp=datetime(2026, 1, 1),
        )

        service.transaction_service.log_transaction(
            Transaction(
                id="t2",
                user_id="user-a",
                account_id="acc1",
                instrument_id="goog",
                type=TransactionType.BUY,
                quantity=Decimal("5"),
                price=Decimal("100"),
                timestamp=datetime(2026, 1, 2),
            )
        )

        cash_balance = service.transaction_service.get_position(
            "acc1", CASH_INSTRUMENT_ID, user_id="user-a"
        )
        assert cash_balance is not None
        assert cash_balance.share_count == Decimal("1000")

    def test_withdrawal_and_an_instrument_sell_in_the_same_account_stay_independent(
        self,
    ) -> None:
        """The withdrawal/sell side of the mix — deposit, buy, sell part of
        the position, withdraw some cash — cash and instrument positions
        must each reflect only their own transactions throughout."""
        instrument_repo = FakeInstrumentRepository(
            [
                Instrument(
                    id="goog",
                    symbol="GOOG",
                    name="Alphabet",
                    asset_class=AssetClass.EQUITY,
                )
            ]
        )
        service = _cash_service(instrument_repo)
        service.deposit(
            id="t1",
            user_id="user-a",
            account_id="acc1",
            amount=Decimal("1000"),
            timestamp=datetime(2026, 1, 1),
        )
        service.transaction_service.log_transaction(
            Transaction(
                id="t2",
                user_id="user-a",
                account_id="acc1",
                instrument_id="goog",
                type=TransactionType.BUY,
                quantity=Decimal("10"),
                price=Decimal("50"),
                timestamp=datetime(2026, 1, 2),
            )
        )
        service.transaction_service.log_transaction(
            Transaction(
                id="t3",
                user_id="user-a",
                account_id="acc1",
                instrument_id="goog",
                type=TransactionType.SELL,
                quantity=Decimal("4"),
                price=Decimal("60"),
                timestamp=datetime(2026, 1, 3),
            )
        )
        service.withdraw(
            id="t4",
            user_id="user-a",
            account_id="acc1",
            amount=Decimal("300"),
            timestamp=datetime(2026, 1, 4),
        )

        cash_balance = service.transaction_service.get_position(
            "acc1", CASH_INSTRUMENT_ID, user_id="user-a"
        )
        goog_balance = service.transaction_service.get_position(
            "acc1", "goog", user_id="user-a"
        )

        assert cash_balance is not None
        assert cash_balance.share_count == Decimal("700")  # 1000 - 300 withdrawn
        assert goog_balance is not None
        assert goog_balance.share_count == Decimal("6")  # 10 bought - 4 sold
