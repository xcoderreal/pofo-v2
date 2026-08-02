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


class AccountType(StrEnum):
    BROKERAGE = "brokerage"
    IRA = "ira"
    CRYPTO_EXCHANGE = "crypto_exchange"
    CASH = "cash"


@dataclass
class Account:
    id: str
    user_id: str
    name: str
    institution: str
    account_type: AccountType
