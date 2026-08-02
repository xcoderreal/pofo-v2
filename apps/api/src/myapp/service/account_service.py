from dataclasses import dataclass

from myapp.domain.model import Account
from myapp.domain.repository import AccountRepository, TransactionRepository


class DuplicateIdError(Exception):
    """An Account with this id already exists.

    `accounts.id` is `text primary key` in the SQL migration — an
    unenforced collision here works today (MemoryAccountRepository just
    overwrites nothing and both rows coexist) but would hard-fail against
    real Postgres. Same reasoning as InstrumentService.DuplicateIdError.
    """


@dataclass
class AccountService:
    repo: AccountRepository
    # Deleting an Account means deleting its ledger too, so the Account's
    # own lifecycle service is what owns that cascade. Depending on a
    # second repository is the same shape TransactionService already has
    # (it takes three) — not a new pattern.
    transaction_repo: TransactionRepository

    def list_accounts(self, user_id: str) -> list[Account]:
        return self.repo.list_by_user(user_id)

    def get_account(self, account_id: str, user_id: str) -> Account | None:
        """Cross-user reads return None (→ 404, not 403) — same policy a
        real RLS-backed adapter would enforce at the query layer."""
        account = self.repo.get(account_id)
        if account is None or account.user_id != user_id:
            return None
        return account

    def create_account(self, account: Account) -> Account:
        if self.repo.get(account.id) is not None:
            raise DuplicateIdError(f"Account with id {account.id!r} already exists")
        self.repo.add(account)
        return account

    def delete_account(self, account_id: str, user_id: str) -> int | None:
        """Delete an Account and every Transaction recorded in it.

        Returns how many Transactions went with it, or **None** when the
        account isn't the requesting user's (or doesn't exist) — the same
        "cross-user is indistinguishable from not-found" signal
        `get_account` gives, which the route turns into a 404. Ownership is
        checked here rather than in the repository for exactly that reason:
        a `delete(account_id)` taken straight off a request would be a
        cross-user delete.

        **No cross-account replay check, and that is not an oversight.**
        Editing or deleting a single Transaction *is* guarded by one
        (docs/adr/0001-dashboard-v2.md § 7), because removing a funding
        Deposit orphans the purchases that came after it. A whole Account
        needs no such guard: FIFO lot matching is strictly scoped per
        Account (docs/domain-model.md § "Why FIFO scoped per Account" —
        `Lot.close()` raises on an account mismatch rather than trusting
        the caller), so an Account's Transactions cannot be closing lots
        anywhere else, and every Transaction that could be invalidated by
        this deletion is itself being deleted. Adding a replay here would
        be a check that can never fire.

        The paired CASH legs come along for free: a trade's cash leg is an
        ordinary Transaction on the *same* Account
        (docs/adr/0001-dashboard-v2.md § 1), so deleting by account takes
        both halves and can never leave a leg behind pointing at a
        `trade_id` that no longer exists.

        Ledger first, then the Account: the intermediate state a failure
        would leave is an empty-but-present Account, which every read path
        already handles (it is what a freshly created one looks like). The
        reverse order would leave Transactions whose Account is gone, which
        nothing handles.
        """
        account = self.get_account(account_id, user_id=user_id)
        if account is None:
            return None

        removed = len(self.transaction_repo.list_by_account(account_id))
        self.transaction_repo.delete_by_account(account_id)
        self.repo.delete(account_id)
        return removed
