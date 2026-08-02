from dataclasses import dataclass

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
        account = self.account_repo.get(transaction.account_id)
        if account is None or account.user_id != transaction.user_id:
            raise AccountNotFoundError(f"Account {transaction.account_id!r} not found")
        if self.instrument_repo.get(transaction.instrument_id) is None:
            raise InstrumentNotFoundError(
                f"Instrument {transaction.instrument_id!r} not found"
            )

        existing = self.transaction_repo.list_by_account_instrument(
            transaction.account_id, transaction.instrument_id
        )
        # Re-runs FIFO matching over existing + this new transaction purely
        # to validate it — raises InsufficientSharesError for an over-sell
        # before anything is persisted. Recomputing on every write is fine
        # at this scale; positions are computed, never stored, by design.
        compute_lots([*existing, transaction])

        self.transaction_repo.add(transaction)
        return transaction

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
