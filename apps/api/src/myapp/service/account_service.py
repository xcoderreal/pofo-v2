from dataclasses import dataclass

from myapp.domain.model import Account
from myapp.domain.repository import AccountRepository


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
