from dataclasses import dataclass

from myapp.domain.model import Instrument
from myapp.domain.repository import InstrumentRepository


class DuplicateSymbolError(Exception):
    """An Instrument with this symbol already exists."""


class DuplicateIdError(Exception):
    """An Instrument with this id already exists.

    Instrument.id is the future join key Transaction.instrument_id will
    reference, so an unenforced collision is a real data-integrity risk
    for this resource specifically — worth checking even though nothing
    references Instruments by id yet.
    """


@dataclass
class InstrumentService:
    repo: InstrumentRepository

    def list_instruments(self) -> list[Instrument]:
        return self.repo.list_all()

    def get_instrument(self, instrument_id: str) -> Instrument | None:
        return self.repo.get(instrument_id)

    def create_instrument(self, instrument: Instrument) -> Instrument:
        if self.repo.get(instrument.id) is not None:
            raise DuplicateIdError(
                f"Instrument with id {instrument.id!r} already exists"
            )
        if self.repo.get_by_symbol(instrument.symbol) is not None:
            raise DuplicateSymbolError(
                f"Instrument with symbol {instrument.symbol!r} already exists"
            )
        self.repo.add(instrument)
        return instrument
