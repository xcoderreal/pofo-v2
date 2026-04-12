"""End-to-end tests — comprehensive real-HTTP coverage for the portfolio tracker.

Runs over whatever `base_url` resolves to. Intent: "is any feature broken?"
"""

from __future__ import annotations

import uuid

import httpx
import pytest


def _suffix() -> str:
    return uuid.uuid4().hex[:8]


def _setup_account_and_instrument(http_client: httpx.Client, suffix: str):
    """Create an account and instrument for testing."""
    http_client.post(
        "/accounts",
        json={
            "id": f"acct-{suffix}",
            "name": f"Test Account {suffix}",
            "account_type": "brokerage",
        },
    )
    http_client.post(
        "/instruments",
        json={
            "id": f"inst-{suffix}",
            "ticker": f"T{suffix[:4].upper()}",
            "name": f"Test Stock {suffix}",
        },
    )


# ─── Read-only (safe against any target) ────────────────────────────


def test_health_shape(http_client: httpx.Client):
    resp = http_client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_list_accounts_returns_list(http_client: httpx.Client):
    resp = http_client.get("/accounts")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_list_instruments_returns_list(http_client: httpx.Client):
    resp = http_client.get("/instruments")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_list_transactions_returns_list(http_client: httpx.Client):
    resp = http_client.get("/transactions")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_positions_returns_list(http_client: httpx.Client):
    resp = http_client.get("/positions")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_gains_returns_list(http_client: httpx.Client):
    resp = http_client.get("/gains")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_history_returns_list(http_client: httpx.Client):
    resp = http_client.get("/history")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_get_account_not_found(http_client: httpx.Client):
    resp = http_client.get(f"/accounts/missing-{_suffix()}")
    assert resp.status_code == 404


def test_get_instrument_not_found(http_client: httpx.Client):
    resp = http_client.get(f"/instruments/missing-{_suffix()}")
    assert resp.status_code == 404


def test_get_transaction_not_found(http_client: httpx.Client):
    resp = http_client.get(f"/transactions/missing-{_suffix()}")
    assert resp.status_code == 404


# ─── Write endpoints (gated) ─────────────────────────────────────────


def test_account_crud(http_client: httpx.Client, allow_writes: bool):
    if not allow_writes:
        pytest.skip("writes disabled")

    s = _suffix()
    resp = http_client.post(
        "/accounts",
        json={
            "id": f"acct-{s}",
            "name": "E2E Account",
            "account_type": "brokerage",
        },
    )
    assert resp.status_code == 201
    assert resp.json()["id"] == f"acct-{s}"

    got = http_client.get(f"/accounts/acct-{s}")
    assert got.status_code == 200


def test_instrument_crud(http_client: httpx.Client, allow_writes: bool):
    if not allow_writes:
        pytest.skip("writes disabled")

    s = _suffix()
    resp = http_client.post(
        "/instruments",
        json={
            "id": f"inst-{s}",
            "ticker": "AAPL",
            "name": "Apple Inc.",
        },
    )
    assert resp.status_code == 201


def test_buy_transaction(http_client: httpx.Client, allow_writes: bool):
    if not allow_writes:
        pytest.skip("writes disabled")

    s = _suffix()
    _setup_account_and_instrument(http_client, s)
    resp = http_client.post(
        "/transactions",
        json={
            "id": f"txn-{s}",
            "account_id": f"acct-{s}",
            "instrument_id": f"inst-{s}",
            "type": "buy",
            "quantity": 10,
            "price": 100.0,
            "date": "2024-01-15",
        },
    )
    assert resp.status_code == 201
    assert resp.json()["type"] == "buy"


def test_sell_validation(http_client: httpx.Client, allow_writes: bool):
    if not allow_writes:
        pytest.skip("writes disabled")

    s = _suffix()
    _setup_account_and_instrument(http_client, s)
    # Try to sell without buying first
    resp = http_client.post(
        "/transactions",
        json={
            "id": f"sell-{s}",
            "account_id": f"acct-{s}",
            "instrument_id": f"inst-{s}",
            "type": "sell",
            "quantity": 10,
            "price": 150.0,
            "date": "2024-06-01",
        },
    )
    assert resp.status_code == 400


def test_full_portfolio_flow(http_client: httpx.Client, allow_writes: bool):
    """Buy, sell, check positions and gains."""
    if not allow_writes:
        pytest.skip("writes disabled")

    s = _suffix()
    _setup_account_and_instrument(http_client, s)

    # Buy 10 @ 100
    http_client.post(
        "/transactions",
        json={
            "id": f"buy-{s}",
            "account_id": f"acct-{s}",
            "instrument_id": f"inst-{s}",
            "type": "buy",
            "quantity": 10,
            "price": 100.0,
            "date": "2024-01-01",
        },
    )

    # Sell 5 @ 150
    http_client.post(
        "/transactions",
        json={
            "id": f"sell-{s}",
            "account_id": f"acct-{s}",
            "instrument_id": f"inst-{s}",
            "type": "sell",
            "quantity": 5,
            "price": 150.0,
            "date": "2024-06-01",
        },
    )

    # Check positions
    positions = http_client.get("/positions", params={"account_id": f"acct-{s}"}).json()
    matching = [p for p in positions if p["instrument_id"] == f"inst-{s}"]
    assert len(matching) == 1
    assert matching[0]["quantity"] == 5

    # Check gains
    gains = http_client.get("/gains", params={"account_id": f"acct-{s}"}).json()
    matching_gains = [g for g in gains if g["sell_transaction_id"] == f"sell-{s}"]
    assert len(matching_gains) == 1
    assert matching_gains[0]["gain"] == 250.0

    # Check history
    history = http_client.get("/history", params={"account_id": f"acct-{s}"}).json()
    assert len(history) >= 1


# ─── Error paths ─────────────────────────────────────────────────────


def test_create_account_missing_field(http_client: httpx.Client, allow_writes: bool):
    if not allow_writes:
        pytest.skip("writes disabled")
    resp = http_client.post("/accounts", json={"name": "no-id"})
    assert resp.status_code == 422


def test_create_transaction_invalid_type(http_client: httpx.Client, allow_writes: bool):
    if not allow_writes:
        pytest.skip("writes disabled")
    resp = http_client.post(
        "/transactions",
        json={
            "id": "bad",
            "account_id": "a1",
            "instrument_id": "i1",
            "type": "invalid",
            "quantity": 10,
            "price": 100,
            "date": "2024-01-01",
        },
    )
    assert resp.status_code in (400, 422, 500)


def test_unknown_route_returns_json_404(http_client: httpx.Client):
    resp = http_client.get("/nope")
    assert resp.status_code == 404
    ctype = resp.headers.get("content-type", "")
    assert "application/json" in ctype
