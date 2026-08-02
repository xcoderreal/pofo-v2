import pytest

from myapp.domain.model import AssetClass, Instrument
from myapp.service.instrument_service import (
    DuplicateIdError,
    DuplicateSymbolError,
    InstrumentService,
)
from tests.fake_repository import FakeInstrumentRepository


def test_create_instrument_adds_it_to_the_repo() -> None:
    service = InstrumentService(repo=FakeInstrumentRepository())

    instrument = service.create_instrument(
        Instrument(
            id="1", symbol="goog", name="Alphabet", asset_class=AssetClass.EQUITY
        )
    )

    assert instrument.symbol == "GOOG"
    assert service.list_instruments() == [instrument]


def test_create_instrument_rejects_duplicate_symbol() -> None:
    repo = FakeInstrumentRepository(
        [
            Instrument(
                id="1", symbol="GOOG", name="Alphabet", asset_class=AssetClass.EQUITY
            )
        ]
    )
    service = InstrumentService(repo=repo)

    with pytest.raises(DuplicateSymbolError):
        service.create_instrument(
            Instrument(
                id="2",
                symbol="goog",
                name="Alphabet dup",
                asset_class=AssetClass.EQUITY,
            )
        )


def test_create_instrument_rejects_duplicate_id_even_with_different_symbol() -> None:
    repo = FakeInstrumentRepository(
        [
            Instrument(
                id="1", symbol="GOOG", name="Alphabet", asset_class=AssetClass.EQUITY
            )
        ]
    )
    service = InstrumentService(repo=repo)

    with pytest.raises(DuplicateIdError):
        service.create_instrument(
            Instrument(
                id="1",
                symbol="MSFT",
                name="Microsoft",
                asset_class=AssetClass.EQUITY,
            )
        )


def test_list_instruments_returns_all() -> None:
    repo = FakeInstrumentRepository(
        [
            Instrument(
                id="1", symbol="GOOG", name="Alphabet", asset_class=AssetClass.EQUITY
            ),
            Instrument(
                id="2", symbol="BTC", name="Bitcoin", asset_class=AssetClass.CRYPTO
            ),
        ]
    )
    service = InstrumentService(repo=repo)

    assert len(service.list_instruments()) == 2


def test_get_instrument_by_id() -> None:
    instrument = Instrument(
        id="1", symbol="GOOG", name="Alphabet", asset_class=AssetClass.EQUITY
    )
    service = InstrumentService(repo=FakeInstrumentRepository([instrument]))

    assert service.get_instrument("1") == instrument
    assert service.get_instrument("missing") is None
