from dataclasses import dataclass, field
from datetime import date
from enum import Enum


class AccountType(Enum):
    BROKERAGE = "brokerage"
    CASH = "cash"


class TransactionType(Enum):
    BUY = "buy"
    SELL = "sell"


@dataclass
class Account:
    id: str
    name: str
    account_type: AccountType


@dataclass
class Instrument:
    id: str
    ticker: str
    name: str


@dataclass
class Transaction:
    id: str
    account_id: str
    instrument_id: str
    type: TransactionType
    quantity: float
    price: float
    date: date


@dataclass
class Lot:
    """A remaining lot from a buy, after FIFO matching against sells."""

    transaction_id: str
    quantity: float
    cost_basis_per_share: float


@dataclass
class RealizedGain:
    """A single realized gain/loss from a sell matched against a buy lot."""

    sell_transaction_id: str
    buy_transaction_id: str
    quantity: float
    buy_price: float
    sell_price: float

    @property
    def gain(self) -> float:
        return (self.sell_price - self.buy_price) * self.quantity


@dataclass
class Position:
    """Computed position for an instrument in an account (or across accounts)."""

    instrument_id: str
    account_id: str | None
    quantity: float
    cost_basis: float
    current_price: float | None = None

    @property
    def cost_basis_per_share(self) -> float:
        if self.quantity == 0:
            return 0.0
        return self.cost_basis / self.quantity

    @property
    def market_value(self) -> float | None:
        if self.current_price is None:
            return None
        return self.quantity * self.current_price

    @property
    def unrealized_gain(self) -> float | None:
        if self.current_price is None:
            return None
        return self.quantity * self.current_price - self.cost_basis


@dataclass
class PortfolioSummary:
    """Aggregated portfolio view."""

    positions: list[Position] = field(default_factory=list)
    realized_gains: list[RealizedGain] = field(default_factory=list)

    @property
    def total_cost_basis(self) -> float:
        return sum(p.cost_basis for p in self.positions)

    @property
    def total_market_value(self) -> float | None:
        values = [p.market_value for p in self.positions]
        if any(v is None for v in values):
            return None
        return sum(v for v in values if v is not None)

    @property
    def total_unrealized_gain(self) -> float | None:
        gains = [p.unrealized_gain for p in self.positions]
        if any(g is None for g in gains):
            return None
        return sum(g for g in gains if g is not None)

    @property
    def total_realized_gain(self) -> float:
        return sum(g.gain for g in self.realized_gains)


@dataclass
class DailyValue:
    """A single day's portfolio value for time-series charts."""

    date: date
    market_value: float
    cost_basis: float
