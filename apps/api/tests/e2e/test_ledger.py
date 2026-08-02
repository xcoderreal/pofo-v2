"""The Activity feed's endpoint over real HTTP.

Network-free like tests/e2e/test_positions.py: nothing here needs a market
price. A ledger entry's amount is `quantity x price` off the Transaction
itself and realized gain is pure FIFO math over the ledger
(docs/domain-model.md § Gains), so every field below is deterministic.

The centrepiece is the collision case
docs/adr/0001-dashboard-v2.md § 2 names: two CASH BUYs in one account, on
one day, for the same amount — one the proceeds leg of a sell, one a
genuine Deposit. They are distinguishable by exactly one thing, and it
has to survive the wire.
"""

from __future__ import annotations

import uuid

import httpx
import pytest

DAY = "2026-02-10T00:00:00"


def _seed_account_and_instrument(client: httpx.Client) -> tuple[str, str]:
    account_id = f"e2e-ledger-acc-{uuid.uuid4().hex[:8]}"
    client.post(
        "/accounts",
        json={
            "id": account_id,
            "name": "E2E Ledger Brokerage",
            "institution": "E2E Bank",
            "account_type": "brokerage",
        },
    )
    symbol = f"E2E{uuid.uuid4().hex[:6].upper()}"
    instrument_id = f"i-{symbol.lower()}"
    client.post(
        "/instruments",
        json={
            "id": instrument_id,
            "symbol": symbol,
            "name": "E2E Ledger Instrument",
            "asset_class": "equity",
        },
    )
    return account_id, instrument_id


def _deposit(client: httpx.Client, account_id: str, amount: str, when: str) -> None:
    resp = client.post(
        "/transactions/deposit",
        json={"account_id": account_id, "amount": amount, "timestamp": when},
    )
    assert resp.status_code == 201, resp.text


def _trade(
    client: httpx.Client,
    account_id: str,
    instrument_id: str,
    kind: str,
    quantity: str,
    price: str,
    when: str,
) -> None:
    resp = client.post(
        "/transactions",
        json={
            "account_id": account_id,
            "instrument_id": instrument_id,
            "type": kind,
            "quantity": quantity,
            "price": price,
            "timestamp": when,
        },
    )
    assert resp.status_code == 201, resp.text


def test_ledger_round_trip_pairs_every_trade_with_a_correlated_cash_leg(
    http_client: httpx.Client, allow_writes: bool
) -> None:
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    account_id, instrument_id = _seed_account_and_instrument(http_client)
    _deposit(http_client, account_id, "10000", "2026-01-01T00:00:00")
    _trade(
        http_client,
        account_id,
        instrument_id,
        "buy",
        "10",
        "100",
        "2026-01-02T00:00:00",
    )
    _trade(
        http_client,
        account_id,
        instrument_id,
        "sell",
        "4",
        "150",
        "2026-01-03T00:00:00",
    )

    resp = http_client.get("/transactions", params={"accounts": [account_id]})

    assert resp.status_code == 200, resp.text
    rows = resp.json()

    # Five rows for three user actions: the deposit, and both legs of each
    # trade (docs/adr/0001-dashboard-v2.md § 1).
    assert len(rows) == 5
    # Newest first, which is the order Activity groups into months.
    assert [row["timestamp"] for row in rows] == sorted(
        (row["timestamp"] for row in rows), reverse=True
    )

    by_id = {row["id"]: row for row in rows}
    sell = next(
        row
        for row in rows
        if row["instrument_id"] == instrument_id and row["type"] == "sell"
    )
    buy = next(
        row
        for row in rows
        if row["instrument_id"] == instrument_id and row["type"] == "buy"
    )
    deposit = next(
        row
        for row in rows
        if row["instrument_id"] == "cash" and row["trade_id"] is None
    )

    assert sell["realized_gain"] == "200"  # (150 - 100) * 4
    assert buy["realized_gain"] is None
    assert deposit["trade_id"] is None
    assert deposit["quantity"] == "10000"

    # Each trade's cash leg names its trade, and the named row is really
    # in the feed — not a dangling id.
    for trade in (buy, sell):
        leg = next(
            row
            for row in rows
            if row["instrument_id"] == "cash" and row["trade_id"] == trade["id"]
        )
        assert leg["price"] == "1"
        assert by_id[leg["trade_id"]]["id"] == trade["id"]

    # A BUY debits cash, a SELL credits it.
    def leg_type(trade: dict) -> str:
        return next(
            row["type"]
            for row in rows
            if row["trade_id"] == trade["id"] and row["id"] != trade["id"]
        )

    assert leg_type(buy) == "sell"
    assert leg_type(sell) == "buy"


def test_a_same_day_equal_amount_deposit_and_proceeds_leg_differ_only_by_trade_id(
    http_client: httpx.Client, allow_writes: bool
) -> None:
    """The exact collision that rules out matching legs on account,
    timestamp and amount (docs/adr/0001-dashboard-v2.md § 2). Both rows
    below are CASH BUYs of 1500, in one account, at one timestamp."""
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    account_id, instrument_id = _seed_account_and_instrument(http_client)
    _deposit(http_client, account_id, "5000", "2026-01-01T00:00:00")
    _trade(
        http_client,
        account_id,
        instrument_id,
        "buy",
        "10",
        "100",
        "2026-01-02T00:00:00",
    )
    # Proceeds: 10 x 150 = 1500, posted as a CASH BUY on DAY.
    _trade(http_client, account_id, instrument_id, "sell", "10", "150", DAY)
    # And a genuine Deposit of exactly 1500 at exactly the same instant.
    _deposit(http_client, account_id, "1500", DAY)

    rows = http_client.get("/transactions", params={"accounts": [account_id]}).json()
    same_day_cash_buys = [
        row
        for row in rows
        if row["instrument_id"] == "cash"
        and row["type"] == "buy"
        and row["timestamp"].startswith("2026-02-10")
        and row["quantity"] == "1500"
    ]

    assert len(same_day_cash_buys) == 2
    assert sorted(row["trade_id"] is None for row in same_day_cash_buys) == [
        False,
        True,
    ]


def test_instruments_param_scopes_the_feed(
    http_client: httpx.Client, allow_writes: bool
) -> None:
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    account_id, instrument_id = _seed_account_and_instrument(http_client)
    _deposit(http_client, account_id, "10000", "2026-01-01T00:00:00")
    _trade(
        http_client,
        account_id,
        instrument_id,
        "buy",
        "10",
        "100",
        "2026-01-02T00:00:00",
    )

    resp = http_client.get(
        "/transactions",
        params={"accounts": [account_id], "instruments": [instrument_id]},
    )

    assert resp.status_code == 200, resp.text
    assert [row["instrument_id"] for row in resp.json()] == [instrument_id]


def test_an_account_with_no_history_yields_no_entries(
    http_client: httpx.Client, allow_writes: bool
) -> None:
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    account_id, _ = _seed_account_and_instrument(http_client)

    resp = http_client.get("/transactions", params={"accounts": [account_id]})

    assert resp.status_code == 200, resp.text
    assert resp.json() == []


def test_an_unknown_account_filter_yields_no_entries_rather_than_a_404(
    http_client: httpx.Client,
) -> None:
    resp = http_client.get("/transactions", params={"accounts": ["no-such-account"]})

    assert resp.status_code == 200, resp.text
    assert resp.json() == []
