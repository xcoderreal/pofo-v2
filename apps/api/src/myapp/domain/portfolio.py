"""Pure portfolio computation — FIFO lot matching, positions, capital gains.

No I/O, no framework deps. All functions take domain objects and return
domain objects. Testable with plain pytest.
"""

from __future__ import annotations

from myapp.domain.model import (
    Lot,
    Position,
    RealizedGain,
    Transaction,
    TransactionType,
)


def compute_lots_and_gains(
    transactions: list[Transaction],
) -> tuple[list[Lot], list[RealizedGain]]:
    """FIFO lot matching: process transactions in date order, return remaining
    lots and realized gains.

    Buys create lots. Sells consume lots in FIFO order (earliest buy first).
    Returns (remaining_lots, realized_gains).
    """
    sorted_txns = sorted(transactions, key=lambda t: (t.date, t.type.value))

    lots: list[Lot] = []
    realized: list[RealizedGain] = []

    for txn in sorted_txns:
        if txn.type == TransactionType.BUY:
            lots.append(
                Lot(
                    transaction_id=txn.id,
                    quantity=txn.quantity,
                    cost_basis_per_share=txn.price,
                )
            )
        elif txn.type == TransactionType.SELL:
            remaining = txn.quantity
            while remaining > 0 and lots:
                lot = lots[0]
                matched = min(remaining, lot.quantity)
                realized.append(
                    RealizedGain(
                        sell_transaction_id=txn.id,
                        buy_transaction_id=lot.transaction_id,
                        quantity=matched,
                        buy_price=lot.cost_basis_per_share,
                        sell_price=txn.price,
                    )
                )
                lot.quantity -= matched
                remaining -= matched
                if lot.quantity <= 0:
                    lots.pop(0)

    return lots, realized


def compute_positions(
    transactions: list[Transaction],
    prices: dict[str, float] | None = None,
    account_id: str | None = None,
    instrument_id: str | None = None,
) -> list[Position]:
    """Compute positions from transactions, optionally filtered by account/instrument.

    Groups by (account_id, instrument_id), runs FIFO on each group,
    and returns positions with current prices attached if available.
    """
    prices = prices or {}

    filtered = transactions
    if account_id:
        filtered = [t for t in filtered if t.account_id == account_id]
    if instrument_id:
        filtered = [t for t in filtered if t.instrument_id == instrument_id]

    groups: dict[tuple[str, str], list[Transaction]] = {}
    for txn in filtered:
        key = (txn.account_id, txn.instrument_id)
        groups.setdefault(key, []).append(txn)

    positions: list[Position] = []
    for (acct_id, inst_id), txns in groups.items():
        lots, _ = compute_lots_and_gains(txns)
        total_qty = sum(lot.quantity for lot in lots)
        total_cost = sum(lot.quantity * lot.cost_basis_per_share for lot in lots)
        if total_qty > 0:
            positions.append(
                Position(
                    instrument_id=inst_id,
                    account_id=acct_id,
                    quantity=total_qty,
                    cost_basis=total_cost,
                    current_price=prices.get(inst_id),
                )
            )

    return positions


def compute_positions_by_instrument(
    transactions: list[Transaction],
    prices: dict[str, float] | None = None,
    instrument_id: str | None = None,
) -> list[Position]:
    """Aggregate positions across all accounts, grouped by instrument only."""
    prices = prices or {}

    filtered = transactions
    if instrument_id:
        filtered = [t for t in filtered if t.instrument_id == instrument_id]

    groups: dict[str, list[Transaction]] = {}
    for txn in filtered:
        groups.setdefault(txn.instrument_id, []).append(txn)

    positions: list[Position] = []
    for inst_id, txns in groups.items():
        lots, _ = compute_lots_and_gains(txns)
        total_qty = sum(lot.quantity for lot in lots)
        total_cost = sum(lot.quantity * lot.cost_basis_per_share for lot in lots)
        if total_qty > 0:
            positions.append(
                Position(
                    instrument_id=inst_id,
                    account_id=None,
                    quantity=total_qty,
                    cost_basis=total_cost,
                    current_price=prices.get(inst_id),
                )
            )

    return positions


def compute_realized_gains(
    transactions: list[Transaction],
    account_id: str | None = None,
    instrument_id: str | None = None,
) -> list[RealizedGain]:
    """Compute realized gains, optionally filtered."""
    filtered = transactions
    if account_id:
        filtered = [t for t in filtered if t.account_id == account_id]
    if instrument_id:
        filtered = [t for t in filtered if t.instrument_id == instrument_id]

    groups: dict[tuple[str, str], list[Transaction]] = {}
    for txn in filtered:
        key = (txn.account_id, txn.instrument_id)
        groups.setdefault(key, []).append(txn)

    all_gains: list[RealizedGain] = []
    for txns in groups.values():
        _, gains = compute_lots_and_gains(txns)
        all_gains.extend(gains)

    return all_gains
