from myapp.domain.model import Instrument
from myapp.domain.repository import InstrumentRepository


class FakeInstrumentRepository(InstrumentRepository):
    def __init__(self, instruments: list[Instrument] | None = None):
        self._instruments: list[Instrument] = list(instruments or [])

    def list_all(self) -> list[Instrument]:
        return list(self._instruments)

    def get(self, instrument_id: str) -> Instrument | None:
        for instrument in self._instruments:
            if instrument.id == instrument_id:
                return instrument
        return None

    def get_by_symbol(self, symbol: str) -> Instrument | None:
        for instrument in self._instruments:
            if instrument.symbol == symbol.upper():
                return instrument
        return None

    def add(self, instrument: Instrument) -> None:
        self._instruments.append(instrument)
