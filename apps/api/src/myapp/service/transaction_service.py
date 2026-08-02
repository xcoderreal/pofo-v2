from dataclasses import dataclass
from datetime import date

from myapp.domain.model import Transaction
from myapp.domain.position import Position, compute_lots, compute_position
from myapp.domain.repository import (
    AccountRepository,
    InstrumentRepository,
    TransactionRepository,
)


class AccountNotFoundError(Exception):
    """No account with this id exists, or it isn't owned by the requesting
    user — same signal either way (see docs/auth.md's 401/404 policy)."""


class InstrumentNotFoundError(Exception):
    """No instrument with this id exists."""


@dataclass
class TransactionService:
    transaction_repo: TransactionRepository
    account_repo: AccountRepository
    instrument_repo: InstrumentRepository

    def log_transaction(self, transaction: Transaction) -> Transaction:
        return self.log_transactions([transaction])[0]

    def log_transactions(self, transactions: list[Transaction]) -> list[Transaction]:
        """Validates and persists a batch atomically — either all succeed
        or none are written. Each transaction validates independently
        against its own (account_id, instrument_id) ledger; this assumes
        no two transactions in one batch share an (account_id,
        instrument_id) pair, true for every caller today (e.g. a trade's
        instrument leg and its paired CASH leg are always different
        instruments — see CashService.log_trade)."""
        for transaction in transactions:
            account = self.account_repo.get(transaction.account_id)
            if account is None or account.user_id != transaction.user_id:
                raise AccountNotFoundError(
                    f"Account {transaction.account_id!r} not found"
                )
            if self.instrument_repo.get(transaction.instrument_id) is None:
                raise InstrumentNotFoundError(
                    f"Instrument {transaction.instrument_id!r} not found"
                )

            existing = self.transaction_repo.list_by_account_instrument(
                transaction.account_id, transaction.instrument_id
            )
            # Re-runs FIFO matching over existing + this new transaction
            # purely to validate it — raises InsufficientSharesError for
            # an over-sell before anything is persisted. Recomputing on
            # every write is fine at this scale; positions are computed,
            # never stored, by design.
            compute_lots([*existing, transaction])

        for transaction in transactions:
            self.transaction_repo.add(transaction)
        return transactions

    def get_earliest_transaction_date(self, user_id: str) -> date | None:
        """The day this user's ledger begins, or None if it is empty.

        This is what the dashboard's "Max" range resolves to
        (docs/design/dashboard_v2/behaviour.md § Ranges and granularity).
        The client cannot derive it: the batched positions endpoint
        returns computed *state*, with no dates on it, and asking the
        time-series query would require already knowing how far back to
        ask.

        Scoped by walking the user's own accounts rather than by filtering
        on `Transaction.user_id` — account ownership is the check every
        other read here makes, so this cannot disagree with them.
        """
        timestamps = [
            transaction.timestamp
            for account in self.account_repo.list_by_user(user_id)
            for transaction in self.transaction_repo.list_by_account(account.id)
        ]
        return min(timestamps).date() if timestamps else None

    def list_by_account(
        self, account_id: str, user_id: str
    ) -> list[Transaction] | None:
        """Every Transaction on one of the user's accounts, or None if the
        account isn't theirs (or doesn't exist) — the same "same signal
        either way" treatment `get_position` gives an unowned account.

        Unfiltered on purpose: the paired CASH legs are *in* this list.
        Which of them the Activity feed hides is a display rule keyed on
        the stored `trade_id` (docs/adr/0001-dashboard-v2.md § 2), not a
        property of the ledger, and a read that quietly dropped rows would
        make the ledger endpoint disagree with the position math computed
        from the very same rows.
        """
        account = self.account_repo.get(account_id)
        if account is None or account.user_id != user_id:
            return None
        return self.transaction_repo.list_by_account(account_id)

    def get_position(
        self, account_id: str, instrument_id: str, user_id: str
    ) -> Position | None:
        account = self.account_repo.get(account_id)
        if account is None or account.user_id != user_id:
            return None
        transactions = self.transaction_repo.list_by_account_instrument(
            account_id, instrument_id
        )
        return compute_position(account_id, instrument_id, transactions)
