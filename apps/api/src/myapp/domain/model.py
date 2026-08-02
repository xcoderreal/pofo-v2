from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
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


class TransactionType(StrEnum):
    BUY = "buy"
    SELL = "sell"


@dataclass
class Transaction:
    id: str
    user_id: str
    account_id: str
    instrument_id: str
    type: TransactionType
    quantity: Decimal
    price: Decimal
    timestamp: datetime
    # Set only on the two rows of an auto-paired trade (CashService.log_trade)
    # — both carry the same value, the primary leg's own id. None for a
    # standalone transaction (a Deposit/Withdrawal, or any transaction with
    # no paired counter-entry). This is what lets a paired CASH leg be
    # correlated back to its trade and filtered out of a raw transaction
    # list without matching on account/timestamp/amount, which collides on
    # same-day trades of equal value.
    trade_id: str | None = None
