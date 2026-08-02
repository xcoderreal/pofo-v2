from dataclasses import dataclass
from enum import StrEnum


@dataclass
class User:
    id: str


class AssetClass(StrEnum):
    EQUITY = "equity"
    ETF = "etf"
    CRYPTO = "crypto"
    CASH = "cash"


@dataclass
class Instrument:
    id: str
    symbol: str
    name: str
    asset_class: AssetClass

    def __post_init__(self) -> None:
        self.symbol = self.symbol.upper()
