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
from myapp.service.cash_service import (
    CASH_INSTRUMENT_ID,
    CASH_SYMBOL,
    CashService,
    InsufficientCashError,
)
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

        with pytest.raises(InsufficientCashError) as excinfo:
            service.withdraw(
                id="t2",
                user_id="user-a",
                account_id="acc1",
                amount=Decimal("200"),
                timestamp=datetime(2026, 1, 2),
            )

        # An unpaired CASH SELL overdrawing is the same diagnosis as a
        # trade's cash leg overdrawing, and gets the same error type.
        assert excinfo.value.requested == Decimal("200")
        assert excinfo.value.available == Decimal("100")


class TestLogTrade:
    """log_trade is the one entry point for writing any transaction — a
    Deposit/Withdrawal (already CASH) passes through unpaired; any other
    instrument's BUY/SELL is automatically paired with a CASH leg of
    equal value in the same account (UBIQUITOUS_LANGUAGE.md's Cash
    Balance entry: "the implicit cash leg of every non-cash BUY/SELL")."""

    def test_buying_an_instrument_debits_cash_by_the_trade_value(self) -> None:
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

        service.log_trade(
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
        goog_balance = service.transaction_service.get_position(
            "acc1", "goog", user_id="user-a"
        )
        assert cash_balance is not None
        assert cash_balance.share_count == Decimal("500")  # 1000 - 5*100
        assert goog_balance is not None
        assert goog_balance.share_count == Decimal("5")

    def test_selling_an_instrument_credits_cash_with_the_proceeds(self) -> None:
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
        service.log_trade(
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

        service.log_trade(
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

        cash_balance = service.transaction_service.get_position(
            "acc1", CASH_INSTRUMENT_ID, user_id="user-a"
        )
        assert cash_balance is not None
        assert cash_balance.share_count == Decimal("740")  # 1000 - 500 + 240

    def test_deposit_buy_sell_and_withdrawal_settle_into_one_coherent_cash_balance(
        self,
    ) -> None:
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
        service.log_trade(
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
        service.log_trade(
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
        assert cash_balance.share_count == Decimal("440")  # 1000-500+240-300
        assert goog_balance is not None
        assert goog_balance.share_count == Decimal("6")  # 10 bought - 4 sold

    def test_buying_beyond_available_cash_is_rejected(self) -> None:
        """Insufficient cash isn't a distinct *check* — the paired CASH
        SELL overdraws through exactly the same FIFO path as selling too
        many shares. It is a distinct *diagnosis*: the error names cash, so
        the caller can point at the funding Deposit that belongs earlier in
        the ledger rather than at the quantity typed
        (docs/adr/0001-dashboard-v2.md § 4). No margin/negative-balance
        mode."""
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
            amount=Decimal("100"),
            timestamp=datetime(2026, 1, 1),
        )

        with pytest.raises(InsufficientCashError) as excinfo:
            service.log_trade(
                Transaction(
                    id="t2",
                    user_id="user-a",
                    account_id="acc1",
                    instrument_id="goog",
                    type=TransactionType.BUY,
                    quantity=Decimal("5"),
                    price=Decimal("100"),  # $500 — more cash than deposited
                    timestamp=datetime(2026, 1, 2),
                )
            )

        error = excinfo.value
        # Still an InsufficientSharesError, so nothing that catches the
        # base class changes behaviour.
        assert isinstance(error, InsufficientSharesError)
        assert error.instrument_id == CASH_INSTRUMENT_ID
        assert error.requested == Decimal("500")
        assert error.available == Decimal("100")
        assert "cash" in str(error)

        # Atomic — the GOOG leg must not have been persisted either.
        goog_balance = service.transaction_service.get_position(
            "acc1", "goog", user_id="user-a"
        )
        assert goog_balance is not None
        assert goog_balance.share_count == Decimal("0")

    def test_over_selling_shares_is_not_reported_as_a_cash_problem(self) -> None:
        """The other half of the same rule: an overdraw on the *instrument*
        leg is fixed by selling fewer units, and telling the user to record
        a deposit would send them after the wrong thing."""
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
            amount=Decimal("10000"),
            timestamp=datetime(2026, 1, 1),
        )
        service.log_trade(
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

        with pytest.raises(InsufficientSharesError) as excinfo:
            service.log_trade(
                Transaction(
                    id="t3",
                    user_id="user-a",
                    account_id="acc1",
                    instrument_id="goog",
                    type=TransactionType.SELL,
                    quantity=Decimal("9"),
                    price=Decimal("120"),
                    timestamp=datetime(2026, 1, 3),
                )
            )

        assert not isinstance(excinfo.value, InsufficientCashError)
        assert excinfo.value.instrument_id == "goog"
        assert excinfo.value.available == Decimal("5")

    def test_a_cash_instrument_transaction_passes_through_unpaired(self) -> None:
        """Logging a CASH transaction directly via log_trade (as
        deposit()/withdraw() do internally) must not try to pair CASH
        with itself."""
        service = _cash_service()

        service.log_trade(
            Transaction(
                id="t1",
                user_id="user-a",
                account_id="acc1",
                instrument_id=CASH_INSTRUMENT_ID,
                type=TransactionType.BUY,
                quantity=Decimal("500"),
                price=Decimal("1"),
                timestamp=datetime(2026, 1, 1),
            )
        )

        cash_balance = service.transaction_service.get_position(
            "acc1", CASH_INSTRUMENT_ID, user_id="user-a"
        )
        assert cash_balance is not None
        assert cash_balance.share_count == Decimal("500")


class TestTradeId:
    """trade_id correlates a trade's two rows (the instrument leg and its
    auto-paired CASH leg) without matching on account/timestamp/amount,
    which collides on same-day trades of equal value."""

    def test_a_paired_trade_shares_a_trade_id_across_both_legs(self) -> None:
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

        service.log_trade(
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

        repo = service.transaction_service.transaction_repo
        [goog_leg] = repo.list_by_account_instrument("acc1", "goog")
        [cash_deposit, cash_leg] = repo.list_by_account_instrument(
            "acc1", CASH_INSTRUMENT_ID
        )
        assert goog_leg.trade_id == "t2"  # the primary leg's own id
        assert cash_leg.trade_id == "t2"
        assert cash_deposit.trade_id is None  # the standalone deposit — unpaired

    def test_deposit_and_withdrawal_have_no_trade_id(self) -> None:
        service = _cash_service()
        service.deposit(
            id="t1",
            user_id="user-a",
            account_id="acc1",
            amount=Decimal("1000"),
            timestamp=datetime(2026, 1, 1),
        )
        service.withdraw(
            id="t2",
            user_id="user-a",
            account_id="acc1",
            amount=Decimal("200"),
            timestamp=datetime(2026, 1, 2),
        )

        repo = service.transaction_service.transaction_repo
        transactions = repo.list_by_account_instrument("acc1", CASH_INSTRUMENT_ID)
        assert all(t.trade_id is None for t in transactions)

    def test_two_same_day_equal_value_trades_get_distinct_trade_ids(self) -> None:
        """The scenario that breaks implicit (account, timestamp, amount)
        matching — two trades of identical value on the same day must
        still correlate correctly by trade_id."""
        instrument_repo = FakeInstrumentRepository(
            [
                Instrument(
                    id="goog",
                    symbol="GOOG",
                    name="Alphabet",
                    asset_class=AssetClass.EQUITY,
                ),
                Instrument(
                    id="aapl",
                    symbol="AAPL",
                    name="Apple",
                    asset_class=AssetClass.EQUITY,
                ),
            ]
        )
        service = _cash_service(instrument_repo)
        service.deposit(
            id="t1",
            user_id="user-a",
            account_id="acc1",
            amount=Decimal("10000"),
            timestamp=datetime(2026, 1, 1),
        )

        service.log_trade(
            Transaction(
                id="buy-goog",
                user_id="user-a",
                account_id="acc1",
                instrument_id="goog",
                type=TransactionType.BUY,
                quantity=Decimal("5"),
                price=Decimal("100"),
                timestamp=datetime(2026, 1, 2),
            )
        )
        service.log_trade(
            Transaction(
                id="buy-aapl",
                user_id="user-a",
                account_id="acc1",
                instrument_id="aapl",
                type=TransactionType.BUY,
                quantity=Decimal("5"),
                price=Decimal("100"),  # same account, day, and value as GOOG's
                timestamp=datetime(2026, 1, 2),
            )
        )

        repo = service.transaction_service.transaction_repo
        cash_rows = repo.list_by_account_instrument("acc1", CASH_INSTRUMENT_ID)
        cash_trade_ids = {t.trade_id for t in cash_rows if t.trade_id is not None}
        assert cash_trade_ids == {"buy-goog", "buy-aapl"}
