"""Unit tests for FIFO lot matching and capital gains computation.

These test the pure domain functions with no I/O — the core financial math.
"""

from datetime import date

import pytest

from myapp.domain.model import Transaction, TransactionType
from myapp.domain.portfolio import (
    compute_lots_and_gains,
    compute_positions,
    compute_positions_by_instrument,
    compute_realized_gains,
)


def _buy(id: str, qty: float, price: float, d: str = "2024-01-01") -> Transaction:
    return Transaction(
        id=id,
        account_id="acct1",
        instrument_id="inst1",
        type=TransactionType.BUY,
        quantity=qty,
        price=price,
        date=date.fromisoformat(d),
    )


def _sell(id: str, qty: float, price: float, d: str = "2024-06-01") -> Transaction:
    return Transaction(
        id=id,
        account_id="acct1",
        instrument_id="inst1",
        type=TransactionType.SELL,
        quantity=qty,
        price=price,
        date=date.fromisoformat(d),
    )


# ─── FIFO lot matching ───────────────────────────────────────


class TestFIFOLotMatching:
    def test_single_buy_creates_one_lot(self):
        lots, gains = compute_lots_and_gains([_buy("b1", 10, 100.0)])
        assert len(lots) == 1
        assert lots[0].quantity == 10
        assert lots[0].cost_basis_per_share == 100.0
        assert gains == []

    def test_buy_then_full_sell(self):
        txns = [_buy("b1", 10, 100.0), _sell("s1", 10, 150.0)]
        lots, gains = compute_lots_and_gains(txns)
        assert lots == []
        assert len(gains) == 1
        assert gains[0].quantity == 10
        assert gains[0].buy_price == 100.0
        assert gains[0].sell_price == 150.0

    def test_fifo_order_two_buys_one_sell(self):
        txns = [
            _buy("b1", 5, 100.0, "2024-01-01"),
            _buy("b2", 5, 200.0, "2024-02-01"),
            _sell("s1", 7, 150.0, "2024-06-01"),
        ]
        lots, gains = compute_lots_and_gains(txns)
        # Sell 7: first 5 from b1 @ 100, then 2 from b2 @ 200
        assert len(gains) == 2
        assert gains[0].buy_transaction_id == "b1"
        assert gains[0].quantity == 5
        assert gains[0].buy_price == 100.0
        assert gains[1].buy_transaction_id == "b2"
        assert gains[1].quantity == 2
        assert gains[1].buy_price == 200.0
        # Remaining lot: 3 shares from b2
        assert len(lots) == 1
        assert lots[0].quantity == 3
        assert lots[0].cost_basis_per_share == 200.0

    def test_partial_sell(self):
        txns = [_buy("b1", 10, 100.0), _sell("s1", 3, 120.0)]
        lots, gains = compute_lots_and_gains(txns)
        assert len(lots) == 1
        assert lots[0].quantity == 7
        assert len(gains) == 1
        assert gains[0].quantity == 3

    def test_multiple_sells_exhaust_lots_in_order(self):
        txns = [
            _buy("b1", 10, 50.0, "2024-01-01"),
            _buy("b2", 10, 100.0, "2024-02-01"),
            _sell("s1", 8, 75.0, "2024-03-01"),
            _sell("s2", 8, 120.0, "2024-04-01"),
        ]
        lots, gains = compute_lots_and_gains(txns)
        # s1: 8 from b1 (leaves 2 in b1)
        # s2: 2 from b1, 6 from b2 (leaves 4 in b2)
        assert len(lots) == 1
        assert lots[0].quantity == 4
        assert lots[0].cost_basis_per_share == 100.0
        assert len(gains) == 3

    def test_no_transactions_returns_empty(self):
        lots, gains = compute_lots_and_gains([])
        assert lots == []
        assert gains == []


# ─── Capital gains ────────────────────────────────────────────


class TestCapitalGains:
    def test_realized_gain_positive(self):
        txns = [_buy("b1", 10, 100.0), _sell("s1", 10, 150.0)]
        _, gains = compute_lots_and_gains(txns)
        assert gains[0].gain == pytest.approx(500.0)

    def test_realized_gain_negative_loss(self):
        txns = [_buy("b1", 10, 100.0), _sell("s1", 10, 80.0)]
        _, gains = compute_lots_and_gains(txns)
        assert gains[0].gain == pytest.approx(-200.0)

    def test_mixed_lots_gain_calculation(self):
        txns = [
            _buy("b1", 5, 100.0, "2024-01-01"),
            _buy("b2", 5, 200.0, "2024-02-01"),
            _sell("s1", 7, 150.0, "2024-06-01"),
        ]
        _, gains = compute_lots_and_gains(txns)
        # 5 shares: (150-100)*5 = 250
        # 2 shares: (150-200)*2 = -100
        total = sum(g.gain for g in gains)
        assert total == pytest.approx(150.0)


# ─── Position computation ────────────────────────────────────


class TestComputePositions:
    def test_single_buy_position(self):
        txns = [_buy("b1", 10, 100.0)]
        positions = compute_positions(txns, {"inst1": 150.0})
        assert len(positions) == 1
        p = positions[0]
        assert p.instrument_id == "inst1"
        assert p.account_id == "acct1"
        assert p.quantity == 10
        assert p.cost_basis == pytest.approx(1000.0)
        assert p.current_price == 150.0
        assert p.market_value == pytest.approx(1500.0)
        assert p.unrealized_gain == pytest.approx(500.0)

    def test_position_after_partial_sell(self):
        txns = [_buy("b1", 10, 100.0), _sell("s1", 3, 120.0)]
        positions = compute_positions(txns)
        assert len(positions) == 1
        assert positions[0].quantity == 7
        assert positions[0].cost_basis == pytest.approx(700.0)

    def test_no_position_after_full_sell(self):
        txns = [_buy("b1", 10, 100.0), _sell("s1", 10, 150.0)]
        positions = compute_positions(txns)
        assert positions == []

    def test_filter_by_account(self):
        txns = [
            Transaction(
                "b1", "acct1", "inst1", TransactionType.BUY, 10, 100.0, date(2024, 1, 1)
            ),
            Transaction(
                "b2", "acct2", "inst1", TransactionType.BUY, 5, 110.0, date(2024, 1, 1)
            ),
        ]
        positions = compute_positions(txns, account_id="acct1")
        assert len(positions) == 1
        assert positions[0].account_id == "acct1"
        assert positions[0].quantity == 10

    def test_filter_by_instrument(self):
        txns = [
            Transaction(
                "b1", "acct1", "inst1", TransactionType.BUY, 10, 100.0, date(2024, 1, 1)
            ),
            Transaction(
                "b2", "acct1", "inst2", TransactionType.BUY, 5, 50.0, date(2024, 1, 1)
            ),
        ]
        positions = compute_positions(txns, instrument_id="inst1")
        assert len(positions) == 1
        assert positions[0].instrument_id == "inst1"


class TestComputePositionsByInstrument:
    def test_aggregates_across_accounts(self):
        txns = [
            Transaction(
                "b1", "acct1", "inst1", TransactionType.BUY, 10, 100.0, date(2024, 1, 1)
            ),
            Transaction(
                "b2", "acct2", "inst1", TransactionType.BUY, 5, 110.0, date(2024, 1, 1)
            ),
        ]
        positions = compute_positions_by_instrument(txns, {"inst1": 120.0})
        assert len(positions) == 1
        p = positions[0]
        assert p.account_id is None
        assert p.quantity == 15
        assert p.cost_basis == pytest.approx(1550.0)
        assert p.current_price == 120.0


class TestComputeRealizedGains:
    def test_filter_by_account(self):
        txns = [
            Transaction(
                "b1", "acct1", "inst1", TransactionType.BUY, 10, 100.0, date(2024, 1, 1)
            ),
            Transaction(
                "s1", "acct1", "inst1", TransactionType.SELL, 5, 150.0, date(2024, 6, 1)
            ),
            Transaction(
                "b2", "acct2", "inst1", TransactionType.BUY, 10, 90.0, date(2024, 1, 1)
            ),
            Transaction(
                "s2", "acct2", "inst1", TransactionType.SELL, 3, 130.0, date(2024, 6, 1)
            ),
        ]
        gains = compute_realized_gains(txns, account_id="acct1")
        assert len(gains) == 1
        assert gains[0].sell_transaction_id == "s1"
        assert gains[0].quantity == 5
