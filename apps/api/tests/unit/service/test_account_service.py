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
from myapp.domain.position import compute_position
from myapp.service.account_service import AccountService, DuplicateIdError
from myapp.service.cash_service import CASH_INSTRUMENT_ID, CashService
from myapp.service.instrument_service import InstrumentService
from myapp.service.transaction_service import TransactionService
from tests.fake_repository import (
    FakeAccountRepository,
    FakeInstrumentRepository,
    FakeTransactionRepository,
)


def _service(
    accounts: FakeAccountRepository | None = None,
    transactions: FakeTransactionRepository | None = None,
) -> AccountService:
    return AccountService(
        repo=accounts or FakeAccountRepository(),
        transaction_repo=transactions or FakeTransactionRepository(),
    )


def test_create_account_adds_it_scoped_to_the_owner() -> None:
    service = _service()

    account = service.create_account(
        Account(
            id="1",
            user_id="user-a",
            name="Wells Fargo Brokerage",
            institution="Wells Fargo",
            account_type=AccountType.BROKERAGE,
        )
    )

    assert service.list_accounts(user_id="user-a") == [account]


def test_create_account_rejects_duplicate_id_even_for_a_different_owner() -> None:
    repo = FakeAccountRepository(
        [
            Account(
                id="1",
                user_id="user-a",
                name="A's Brokerage",
                institution="Fidelity",
                account_type=AccountType.BROKERAGE,
            )
        ]
    )
    service = _service(repo)

    with pytest.raises(DuplicateIdError):
        service.create_account(
            Account(
                id="1",
                user_id="user-b",
                name="B's IRA",
                institution="Schwab",
                account_type=AccountType.IRA,
            )
        )


def test_list_accounts_only_returns_the_requesting_users_accounts() -> None:
    repo = FakeAccountRepository(
        [
            Account(
                id="1",
                user_id="user-a",
                name="A's Brokerage",
                institution="Fidelity",
                account_type=AccountType.BROKERAGE,
            ),
            Account(
                id="2",
                user_id="user-b",
                name="B's IRA",
                institution="Schwab",
                account_type=AccountType.IRA,
            ),
        ]
    )
    service = _service(repo)

    accounts = service.list_accounts(user_id="user-a")

    assert [a.id for a in accounts] == ["1"]


def test_get_account_returns_it_for_the_owner() -> None:
    account = Account(
        id="1",
        user_id="user-a",
        name="Brokerage",
        institution="Fidelity",
        account_type=AccountType.BROKERAGE,
    )
    service = _service(FakeAccountRepository([account]))

    assert service.get_account("1", user_id="user-a") == account


def test_get_account_returns_none_for_a_different_user() -> None:
    """Cross-user reads must be indistinguishable from not-found (404, not 403)."""
    account = Account(
        id="1",
        user_id="user-a",
        name="Brokerage",
        institution="Fidelity",
        account_type=AccountType.BROKERAGE,
    )
    service = _service(FakeAccountRepository([account]))

    assert service.get_account("1", user_id="user-b") is None


def test_get_account_returns_none_for_a_missing_id() -> None:
    service = _service()

    assert service.get_account("missing", user_id="user-a") is None


# ─── Cascade delete ───────────────────────────────────────────
#
# A harness rather than raw repository writes, because the thing under
# test is what happens to *real* ledgers: a trade auto-posts a paired CASH
# leg (docs/adr/0001-dashboard-v2.md § 1), and "the cascade takes the legs
# with it" is only a meaningful assertion if the legs were written the way
# CashService writes them.

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
GOOG = Instrument(
    id="goog", symbol="GOOG", name="Alphabet", asset_class=AssetClass.EQUITY
)


class Harness:
    """One set of fakes, an AccountService over them, and a CashService to
    write realistic trades through."""

    def __init__(self, accounts: list[Account] | None = None) -> None:
        self.account_repo = FakeAccountRepository(
            list(accounts) if accounts is not None else [BROKERAGE, IRA]
        )
        self.instrument_repo = FakeInstrumentRepository([GOOG])
        self.transaction_repo = FakeTransactionRepository()
        instrument_service = InstrumentService(repo=self.instrument_repo)
        self.cash_service = CashService(
            transaction_service=TransactionService(
                transaction_repo=self.transaction_repo,
                account_repo=self.account_repo,
                instrument_repo=self.instrument_repo,
            ),
            instrument_service=instrument_service,
        )
        self.service = AccountService(
            repo=self.account_repo, transaction_repo=self.transaction_repo
        )

    def deposit(self, account_id: str, amount: str, *, id: str, day: int) -> None:
        self.cash_service.deposit(
            id=id,
            user_id="user-a",
            account_id=account_id,
            amount=Decimal(amount),
            timestamp=datetime(2026, 1, day, 10, 0),
        )

    def trade(
        self,
        account_id: str,
        type: TransactionType,
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
                instrument_id=GOOG.id,
                type=type,
                quantity=Decimal(quantity),
                price=Decimal(price),
                timestamp=datetime(2026, 1, day, 11, 0),
            )
        )

    def position(self, account_id: str, instrument_id: str):
        return compute_position(
            account_id,
            instrument_id,
            self.transaction_repo.list_by_account_instrument(account_id, instrument_id),
        )


def test_delete_account_removes_the_account_and_reports_the_ledger_it_took() -> None:
    harness = Harness()
    harness.deposit("acc1", "10000", id="d1", day=1)
    harness.trade("acc1", TransactionType.BUY, "10", "100", id="t1", day=2)

    # Deposit + BUY + the BUY's paired CASH leg.
    removed = harness.service.delete_account("acc1", user_id="user-a")

    assert removed == 3
    assert harness.service.get_account("acc1", user_id="user-a") is None
    assert harness.transaction_repo.list_by_account("acc1") == []


def test_delete_account_takes_the_paired_cash_legs_of_its_trades() -> None:
    """The legs are ordinary rows on the same Account, so deleting by
    account can never orphan one pointing at a vanished trade_id."""
    harness = Harness()
    harness.deposit("acc1", "10000", id="d1", day=1)
    harness.trade("acc1", TransactionType.BUY, "10", "100", id="t1", day=2)
    harness.trade("acc1", TransactionType.SELL, "4", "150", id="t2", day=3)

    paired = [
        t
        for t in harness.transaction_repo.list_by_account("acc1")
        if t.trade_id is not None
    ]
    assert len(paired) == 4  # two trades, two legs each

    harness.service.delete_account("acc1", user_id="user-a")

    assert harness.transaction_repo.list_by_account("acc1") == []


def test_delete_account_leaves_other_accounts_holding_the_same_instrument_intact() -> (
    None
):
    """AC 8, and the case a by-instrument implementation would corrupt.

    Both accounts hold GOOG and both have booked a realized gain on it. A
    cascade that deleted GOOG's transactions rather than *this account's*
    transactions would wipe the survivor's position and its gain while
    every assertion about the deleted account still passed.
    """
    harness = Harness()
    for account_id, seq in (("acc1", 1), ("acc2", 2)):
        harness.deposit(account_id, "10000", id=f"d{seq}", day=1)
        harness.trade(account_id, TransactionType.BUY, "10", "100", id=f"b{seq}", day=2)
        harness.trade(account_id, TransactionType.SELL, "4", "150", id=f"s{seq}", day=3)

    before_shares = harness.position("acc2", GOOG.id).share_count
    before_gain = harness.position("acc2", GOOG.id).realized_gain
    before_cash = harness.position("acc2", CASH_INSTRUMENT_ID).share_count
    assert before_shares == Decimal(6)
    assert before_gain == Decimal(200)

    harness.service.delete_account("acc1", user_id="user-a")

    assert harness.position("acc2", GOOG.id).share_count == before_shares
    assert harness.position("acc2", GOOG.id).realized_gain == before_gain
    assert harness.position("acc2", CASH_INSTRUMENT_ID).share_count == before_cash
    assert harness.service.get_account("acc2", user_id="user-a") == IRA


def test_delete_account_refuses_another_users_account() -> None:
    """The ownership boundary: a delete by id must not be a cross-user
    delete. Same None-means-404 signal `get_account` gives."""
    harness = Harness()
    harness.deposit("acc1", "10000", id="d1", day=1)

    assert harness.service.delete_account("acc1", user_id="user-b") is None

    assert harness.service.get_account("acc1", user_id="user-a") == BROKERAGE
    assert len(harness.transaction_repo.list_by_account("acc1")) == 1


def test_delete_account_returns_none_for_a_missing_id() -> None:
    assert _service().delete_account("missing", user_id="user-a") is None


def test_delete_an_empty_account_reports_zero_transactions() -> None:
    harness = Harness()

    assert harness.service.delete_account("acc1", user_id="user-a") == 0
    assert harness.service.list_accounts(user_id="user-a") == [IRA]
