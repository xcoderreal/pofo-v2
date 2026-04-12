from abc import ABC, abstractmethod

from myapp.domain.model import Account, Instrument, Transaction


class AccountRepository(ABC):
    @abstractmethod
    def list_all(self) -> list[Account]: ...

    @abstractmethod
    def get(self, account_id: str) -> Account | None: ...

    @abstractmethod
    def add(self, account: Account) -> None: ...

    @abstractmethod
    def delete(self, account_id: str) -> bool: ...


class InstrumentRepository(ABC):
    @abstractmethod
    def list_all(self) -> list[Instrument]: ...

    @abstractmethod
    def get(self, instrument_id: str) -> Instrument | None: ...

    @abstractmethod
    def add(self, instrument: Instrument) -> None: ...

    @abstractmethod
    def delete(self, instrument_id: str) -> bool: ...


class TransactionRepository(ABC):
    @abstractmethod
    def list_all(self) -> list[Transaction]: ...

    @abstractmethod
    def get(self, transaction_id: str) -> Transaction | None: ...

    @abstractmethod
    def add(self, transaction: Transaction) -> None: ...

    @abstractmethod
    def delete(self, transaction_id: str) -> bool: ...

    @abstractmethod
    def list_by_account(self, account_id: str) -> list[Transaction]: ...

    @abstractmethod
    def list_by_instrument(self, instrument_id: str) -> list[Transaction]: ...
