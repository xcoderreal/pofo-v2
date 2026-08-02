"""FIFO lot matching and position computation.

Ported from a reference implementation (a separate, untouched repo — see
docs/domain-model.md), with one fix: the reference's lot-closing check only
verified opposite transaction signs, with NO account/instrument check at
all — it was only correct because its sole caller happened to pre-filter
transactions by account+instrument before matching ever ran. Lot.close()
here asserts that invariant explicitly and raises on mismatch, so a future
caller (this ticket's own compute_position, or eventually the generic
query interface) can't silently cross-match lots across accounts or
instruments.

Positions are computed on read from the Transaction ledger — never stored.
"""

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from enum import StrEnum

from myapp.domain.model import Transaction, TransactionType


class LotMatchingStrategy(StrEnum):
    """Which open lot a closing transaction consumes first.

    FIFO is the only implemented behavior for v1. LIFO/HIGHEST_COST are
    reserved, unimplemented values — not dead branches for them, just the
    one canonical name for this concept, replacing the reference
    implementation's two colliding `PositionMatchingStrategy` types (a
    live enum and a dead ABC hierarchy) with a single real one. See
    docs/domain-model.md and docs/non-goals.md.
    """

    FIFO = "fifo"
    LIFO = "lifo"
    HIGHEST_COST = "highest_cost"


class LotMismatchError(Exception):
    """A transaction attempted to close a lot opened in a different
    account or for a different instrument."""


class LotOverdrawError(Exception):
    """An attempt to close more of a lot than remains open on it."""


class InsufficientSharesError(Exception):
    """A sell transaction's quantity exceeds what's held (open, matching
    lots) in that account for that instrument.

    Carries the offending pair and the two quantities as fields, not only
    inside a message. The same overdraw means two different things to a
    caller depending on which instrument it fired on: on a trade's own leg
    it is "you don't hold that many shares", and on the CASH leg that trade
    auto-posts it is "you don't have that much money"
    (docs/adr/0001-dashboard-v2.md § 4). Only the instrument tells those
    apart, and a caller reduced to substring-matching the message cannot
    say the right thing about either.

    `message` is overridable so a subclass can phrase the same facts for
    its own case without rewriting `args` after the fact.
    """

    def __init__(
        self,
        *,
        account_id: str,
        instrument_id: str,
        requested: Decimal,
        available: Decimal,
        message: str | None = None,
    ) -> None:
        self.account_id = account_id
        self.instrument_id = instrument_id
        self.requested = requested
        self.available = available
        super().__init__(
            message
            or (
                f"Cannot sell {requested} units of {instrument_id!r} "
                f"in account {account_id!r} — only {available} available"
            )
        )


@dataclass
class Lot:
    opening_transaction: Transaction
    closes: list[tuple[Transaction, Decimal]] = field(default_factory=list)

    @property
    def quantity_remaining(self) -> Decimal:
        closed = sum((qty for _, qty in self.closes), Decimal(0))
        return self.opening_transaction.quantity - closed

    @property
    def is_closed(self) -> bool:
        return self.quantity_remaining == 0

    @property
    def realized_gain(self) -> Decimal:
        """Sum of (closing price - opening price) * quantity across every
        close event against this lot. Zero for a lot with no closes yet."""
        return sum(
            (
                (closing_transaction.price - self.opening_transaction.price) * qty
                for closing_transaction, qty in self.closes
            ),
            Decimal(0),
        )

    def unrealized_gain(self, current_price: Decimal) -> Decimal:
        """(current price - opening price) * quantity still open. Zero once
        the lot is fully closed."""
        open_price = self.opening_transaction.price
        return (current_price - open_price) * self.quantity_remaining

    def close(self, transaction: Transaction, quantity: Decimal) -> None:
        if (
            transaction.account_id != self.opening_transaction.account_id
            or transaction.instrument_id != self.opening_transaction.instrument_id
        ):
            raise LotMismatchError(
                f"Transaction {transaction.id!r} "
                f"(account={transaction.account_id!r}, "
                f"instrument={transaction.instrument_id!r}) "
                f"cannot close a lot opened by {self.opening_transaction.id!r} "
                f"(account={self.opening_transaction.account_id!r}, "
                f"instrument={self.opening_transaction.instrument_id!r})"
            )
        if quantity > self.quantity_remaining:
            raise LotOverdrawError(
                f"Cannot close {quantity} units — "
                f"only {self.quantity_remaining} remaining"
            )
        self.closes.append((transaction, quantity))


@dataclass
class Position:
    account_id: str
    instrument_id: str
    lots: list[Lot]

    @property
    def share_count(self) -> Decimal:
        return sum((lot.quantity_remaining for lot in self.lots), Decimal(0))

    @property
    def cost_basis(self) -> Decimal:
        return sum(
            (
                lot.quantity_remaining * lot.opening_transaction.price
                for lot in self.lots
            ),
            Decimal(0),
        )

    @property
    def realized_gain(self) -> Decimal:
        return sum((lot.realized_gain for lot in self.lots), Decimal(0))

    def unrealized_gain(self, current_price: Decimal) -> Decimal:
        """The documented Composite metric (docs/domain-model.md § Gains):
        equity - cost_basis, built from exactly those two primitives —
        not a second, independent fold over lots."""
        equity = current_price * self.share_count
        return equity - self.cost_basis


def compute_lots(
    transactions: list[Transaction],
    strategy: LotMatchingStrategy = LotMatchingStrategy.FIFO,
) -> list[Lot]:
    """Lot matching: oldest open lot closed first (FIFO — the only
    implemented strategy; see LotMatchingStrategy).

    Candidate lots for a SELL are filtered to matching account_id +
    instrument_id before an attempt to close is made — this is the normal
    correctness logic (a sell can only ever match its own account's
    holdings of that instrument). Lot.close()'s own assertion is a second,
    independent check of the same invariant: it would only ever fire if
    the candidate-filtering here had a bug, which is exactly the class of
    bug the reference implementation this was ported from had no defense
    against at all.
    """
    if strategy != LotMatchingStrategy.FIFO:
        raise NotImplementedError(f"{strategy} lot matching is not implemented yet")

    ordered = sorted(transactions, key=lambda t: t.timestamp)
    lots: list[Lot] = []

    for transaction in ordered:
        if transaction.type == TransactionType.BUY:
            lots.append(Lot(opening_transaction=transaction))
            continue

        remaining = transaction.quantity
        candidates = [
            lot
            for lot in lots
            if not lot.is_closed
            and lot.opening_transaction.account_id == transaction.account_id
            and lot.opening_transaction.instrument_id == transaction.instrument_id
        ]
        candidates.sort(key=lambda lot: lot.opening_transaction.timestamp)

        for lot in candidates:
            if remaining <= 0:
                break
            close_qty = min(remaining, lot.quantity_remaining)
            lot.close(transaction, close_qty)
            remaining -= close_qty

        if remaining > 0:
            raise InsufficientSharesError(
                account_id=transaction.account_id,
                instrument_id=transaction.instrument_id,
                requested=transaction.quantity,
                available=transaction.quantity - remaining,
            )

    return lots


def compute_position(
    account_id: str,
    instrument_id: str,
    transactions: list[Transaction],
    as_of: date | None = None,
) -> Position:
    """`as_of`, when given, computes the position as it stood at the end
    of that date — transactions after it are excluded entirely, as if
    they hadn't happened yet. This is what lets the query interface
    (service/query_service.py) sample a Position at any past date without
    a second, parallel computation path."""
    relevant = [
        t
        for t in transactions
        if t.account_id == account_id
        and t.instrument_id == instrument_id
        and (as_of is None or t.timestamp.date() <= as_of)
    ]
    lots = compute_lots(relevant)
    return Position(account_id=account_id, instrument_id=instrument_id, lots=lots)


def realized_gain_events(lots: list[Lot]) -> list[tuple[Transaction, Decimal]]:
    """Every closing event across the given lots, as (closing transaction,
    gain) — the raw per-event fold the Flow metric `realized_gain` is
    defined over (docs/domain-model.md § Gains). Bucketing these into
    periods is a query-interface concern, not a domain one — see
    service/query_service.py."""
    events = []
    for lot in lots:
        for closing_transaction, quantity in lot.closes:
            gain = (
                closing_transaction.price - lot.opening_transaction.price
            ) * quantity
            events.append((closing_transaction, gain))
    return events
