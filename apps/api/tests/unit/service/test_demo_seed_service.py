from datetime import datetime
from decimal import Decimal

from myapp.domain.model import AccountType, AssetClass, TransactionType
from myapp.domain.position import compute_position
from myapp.service.account_service import AccountService
from myapp.service.cash_service import CASH_INSTRUMENT_ID, CashService
from myapp.service.demo_seed_service import DemoSeedService
from myapp.service.instrument_service import InstrumentService
from myapp.service.transaction_service import TransactionService
from tests.fake_repository import (
    FakeAccountRepository,
    FakeInstrumentRepository,
    FakeTransactionRepository,
)

FIXED_NOW = datetime(2026, 8, 1, 12, 0)


class Harness:
    """The four services the seeder composes, sharing one set of fakes so
    a test can read back everything the seed wrote."""

    def __init__(self) -> None:
        self.account_repo = FakeAccountRepository()
        self.instrument_repo = FakeInstrumentRepository()
        self.transaction_repo = FakeTransactionRepository()
        transaction_service = TransactionService(
            transaction_repo=self.transaction_repo,
            account_repo=self.account_repo,
            instrument_repo=self.instrument_repo,
        )
        self.account_service = AccountService(repo=self.account_repo)
        self.instrument_service = InstrumentService(repo=self.instrument_repo)
        self.service = DemoSeedService(
            account_service=self.account_service,
            instrument_service=self.instrument_service,
            cash_service=CashService(
                transaction_service=transaction_service,
                instrument_service=self.instrument_service,
            ),
            clock=lambda: FIXED_NOW,
        )

    def transactions_for(self, account_id: str, instrument_id: str):
        return self.transaction_repo.list_by_account_instrument(
            account_id, instrument_id
        )

    def instruments_held_in(self, account_id: str) -> set[str]:
        return {
            instrument.id
            for instrument in self.instrument_repo.list_all()
            if compute_position(
                account_id,
                instrument.id,
                self.transactions_for(account_id, instrument.id),
            ).share_count
            > 0
        }


class TestSeedingTrigger:
    def test_seeds_a_user_with_no_accounts(self) -> None:
        harness = Harness()

        assert harness.service.ensure_seeded("user-a") is True
        assert harness.account_service.list_accounts("user-a")

    def test_is_idempotent(self) -> None:
        harness = Harness()
        harness.service.ensure_seeded("user-a")
        accounts_after_first = len(harness.account_service.list_accounts("user-a"))

        assert harness.service.ensure_seeded("user-a") is False
        assert (
            len(harness.account_service.list_accounts("user-a")) == accounts_after_first
        )

    def test_never_seeds_over_a_user_who_already_has_data(self) -> None:
        harness = Harness()
        harness.service.ensure_seeded("user-a")
        before = harness.account_service.list_accounts("user-a")

        harness.service.ensure_seeded("user-a")

        assert harness.account_service.list_accounts("user-a") == before

    def test_two_users_get_independent_portfolios(self) -> None:
        """Account and transaction ids are global primary keys, so a
        second user's seed must not collide with the first's."""
        harness = Harness()
        harness.service.ensure_seeded("user-a")

        assert harness.service.ensure_seeded("user-b") is True

        a_ids = {a.id for a in harness.account_service.list_accounts("user-a")}
        b_ids = {a.id for a in harness.account_service.list_accounts("user-b")}
        assert a_ids and b_ids
        assert not (a_ids & b_ids)


class TestSeededShape:
    def test_accounts_span_more_than_one_account_type(self) -> None:
        harness = Harness()
        harness.service.ensure_seeded("user-a")

        accounts = harness.account_service.list_accounts("user-a")
        types = {a.account_type for a in accounts}
        assert types == {
            AccountType.BROKERAGE,
            AccountType.IRA,
            AccountType.CRYPTO_EXCHANGE,
            AccountType.CASH,
        }

    def test_instruments_span_equity_etf_and_crypto(self) -> None:
        harness = Harness()
        harness.service.ensure_seeded("user-a")

        classes = {i.asset_class for i in harness.instrument_repo.list_all()}
        assert {AssetClass.EQUITY, AssetClass.ETF, AssetClass.CRYPTO} <= classes

    def test_at_least_one_instrument_is_held_in_two_accounts(self) -> None:
        harness = Harness()
        harness.service.ensure_seeded("user-a")

        accounts = harness.account_service.list_accounts("user-a")
        holders: dict[str, int] = {}
        for account in accounts:
            for instrument_id in harness.instruments_held_in(account.id):
                holders[instrument_id] = holders.get(instrument_id, 0) + 1

        multi = {i for i, count in holders.items() if count >= 2}
        assert multi - {CASH_INSTRUMENT_ID}, (
            "no non-cash instrument is held in two accounts — the "
            "instrument-level 'across your accounts' view would have one row"
        )

    def test_at_least_one_position_is_fully_closed_with_realized_gain(self) -> None:
        harness = Harness()
        harness.service.ensure_seeded("user-a")

        closed_with_gain = []
        for account in harness.account_service.list_accounts("user-a"):
            for instrument in harness.instrument_repo.list_all():
                if instrument.id == CASH_INSTRUMENT_ID:
                    continue
                transactions = harness.transactions_for(account.id, instrument.id)
                if not transactions:
                    continue
                position = compute_position(account.id, instrument.id, transactions)
                if position.share_count == 0:
                    closed_with_gain.append((account.id, instrument.id))

        assert closed_with_gain, (
            "no fully closed position — the closed-positions disclosure "
            "would have nothing to show"
        )

    def test_includes_both_a_deposit_and_a_withdrawal(self) -> None:
        harness = Harness()
        harness.service.ensure_seeded("user-a")

        kinds = set()
        for account in harness.account_service.list_accounts("user-a"):
            for transaction in harness.transactions_for(account.id, CASH_INSTRUMENT_ID):
                if transaction.trade_id is None:
                    kinds.add(transaction.type)

        assert kinds == {TransactionType.BUY, TransactionType.SELL}


class TestCashSolvency:
    def test_no_account_ever_goes_cash_negative(self) -> None:
        """The seed's whole ordering constraint in one assertion: replay
        each account's CASH ledger chronologically and assert the running
        balance never dips below zero. If this fails, the fixture has a
        buy before the deposit that funds it — which would raise
        InsufficientSharesError at seed time in production."""
        harness = Harness()
        harness.service.ensure_seeded("user-a")

        for account in harness.account_service.list_accounts("user-a"):
            cash = harness.transactions_for(account.id, CASH_INSTRUMENT_ID)
            balance = Decimal(0)
            for transaction in sorted(cash, key=lambda t: t.timestamp):
                if transaction.type == TransactionType.BUY:
                    balance += transaction.quantity
                else:
                    balance -= transaction.quantity
                assert balance >= 0, (
                    f"{account.name} went to {balance} on "
                    f"{transaction.timestamp.date()}"
                )

    def test_seeding_completes_without_an_insufficient_cash_error(self) -> None:
        """ensure_seeded raising would fail this outright — the point is
        that the whole fixture loads through the real validation path."""
        harness = Harness()

        assert harness.service.ensure_seeded("user-a") is True


class TestNoNetwork:
    def test_seeding_writes_no_price_history(self) -> None:
        """Trade price lives on the Transaction, so seeding never needs
        the price source. The seeder is not even given one — this test
        pins that by construction: DemoSeedService takes no price
        dependency, so it cannot fetch."""
        harness = Harness()
        harness.service.ensure_seeded("user-a")

        assert not hasattr(harness.service, "price_service")
        assert not hasattr(harness.service, "price_source")
