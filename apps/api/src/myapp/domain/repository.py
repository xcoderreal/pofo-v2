from abc import ABC, abstractmethod

from myapp.domain.model import Account, Instrument, Transaction


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
