from abc import ABC, abstractmethod
from datetime import datetime

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


class TransactionRepository(ABC):
    @abstractmethod
    def list_by_account_instrument(
        self, account_id: str, instrument_id: str
    ) -> list[Transaction]: ...

    @abstractmethod
    def add(self, transaction: Transaction) -> None: ...


class PriceHistoryRepository(ABC):
    @abstractmethod
    def get_bars(self, instrument_id: str) -> list[PriceBar]: ...

    @abstractmethod
    def add_bars(self, instrument_id: str, bars: list[PriceBar]) -> None: ...

    @abstractmethod
    def get_last_fetched_at(self, instrument_id: str) -> datetime | None: ...

    @abstractmethod
    def set_last_fetched_at(self, instrument_id: str, when: datetime) -> None: ...
