from abc import ABC, abstractmethod

from myapp.domain.model import Instrument


class InstrumentRepository(ABC):
    @abstractmethod
    def list_all(self) -> list[Instrument]: ...

    @abstractmethod
    def get(self, instrument_id: str) -> Instrument | None: ...

    @abstractmethod
    def get_by_symbol(self, symbol: str) -> Instrument | None: ...

    @abstractmethod
    def add(self, instrument: Instrument) -> None: ...
