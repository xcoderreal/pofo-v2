from abc import ABC, abstractmethod
from datetime import date, datetime

from myapp.domain.model import Account, Instrument, Transaction
from myapp.domain.price import PriceBar


class InstrumentRepository(ABC):
    @abstractmethod
    def list_all(self) -> list[Instrument]: ...

    @abstractmethod
    def get(self, instrument_id: str) -> Instrument | None: ...

    @abstractmethod
    def get_by_symbol(self, symbol: str) -> Instrument | None: ...

    @abstractmethod
    def add(self, instrument: Instrument) -> None: ...


class AccountRepository(ABC):
    @abstractmethod
    def list_by_user(self, user_id: str) -> list[Account]: ...

    @abstractmethod
    def get(self, account_id: str) -> Account | None: ...

    @abstractmethod
    def add(self, account: Account) -> None: ...

    @abstractmethod
    def delete(self, account_id: str) -> None:
        """Remove one Account row. A no-op if the id isn't there.

        Unscoped by user, like `get` — ownership is the service layer's
        check, mirroring how a real RLS policy makes another user's row
        invisible at the query layer rather than requiring the adapter to
        filter. Deleting the Transactions that hang off the account is
        *not* this method's job: see `AccountService.delete_account`.
        """


class TransactionRepository(ABC):
    @abstractmethod
    def list_by_account_instrument(
        self, account_id: str, instrument_id: str
    ) -> list[Transaction]: ...

    @abstractmethod
    def list_by_account(self, account_id: str) -> list[Transaction]: ...

    @abstractmethod
    def add(self, transaction: Transaction) -> None: ...

    @abstractmethod
    def delete_by_account(self, account_id: str) -> None:
        """Remove every Transaction on one Account, whatever its instrument.

        By account, never by instrument: FIFO lot matching is scoped per
        Account (docs/domain-model.md § "Why FIFO scoped per Account"), so
        this is the one deletion shape that cannot reach into another
        account's ledger. It takes the paired CASH legs of the account's
        trades with it for free — they are ordinary rows on the same
        account (docs/adr/0001-dashboard-v2.md § 1).
        """


class PriceHistoryRepository(ABC):
    @abstractmethod
    def get_bars(self, instrument_id: str) -> list[PriceBar]: ...

    @abstractmethod
    def add_bars(self, instrument_id: str, bars: list[PriceBar]) -> None: ...

    @abstractmethod
    def get_last_fetched_at(self, instrument_id: str) -> datetime | None: ...

    @abstractmethod
    def set_last_fetched_at(self, instrument_id: str, when: datetime) -> None: ...

    @abstractmethod
    def get_backfill_floor(self, instrument_id: str) -> date | None: ...

    @abstractmethod
    def set_backfill_floor(self, instrument_id: str, start: date) -> None: ...
