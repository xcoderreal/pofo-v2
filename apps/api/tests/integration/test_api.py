"""API integration tests.

Uses FastAPI's dependency_overrides to inject fake repositories. Each test
gets fresh repo instances that persist across requests within the test, so
round-trip flows (POST -> GET -> list) work as they would against a real store.
"""

import pytest
from fastapi.testclient import TestClient

from myapp.entrypoints.api import (
    app,
    get_account_repo,
    get_instrument_repo,
    get_price_source,
    get_transaction_repo,
)
from tests.fake_price_source import FakePriceSource
from tests.fake_repository import (
    FakeAccountRepository,
    FakeInstrumentRepository,
    FakeTransactionRepository,
)


@pytest.fixture
def account_repo():
    return FakeAccountRepository()


@pytest.fixture
def instrument_repo():
    return FakeInstrumentRepository()


@pytest.fixture
def transaction_repo():
    return FakeTransactionRepository()


@pytest.fixture
def price_source():
    return FakePriceSource({"AAPL": 150.0, "GOOGL": 2800.0})


@pytest.fixture
def client(account_repo, instrument_repo, transaction_repo, price_source):
    app.dependency_overrides[get_account_repo] = lambda: account_repo
    app.dependency_overrides[get_instrument_repo] = lambda: instrument_repo
    app.dependency_overrides[get_transaction_repo] = lambda: transaction_repo
    app.dependency_overrides[get_price_source] = lambda: price_source
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


# ─── Health ───────────────────────────────────────────────────


def test_health(client: TestClient):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# ─── Account endpoints ───────────────────────────────────────


def test_list_accounts_empty(client: TestClient):
    resp = client.get("/accounts")
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_account(client: TestClient):
    payload = {"id": "schwab", "name": "Schwab Brokerage", "account_type": "brokerage"}
    resp = client.post("/accounts", json=payload)
    assert resp.status_code == 201
    assert resp.json()["id"] == "schwab"
    assert resp.json()["account_type"] == "brokerage"


def test_get_account(client: TestClient):
    client.post("/accounts", json={"id": "a1", "name": "Test", "account_type": "cash"})
    resp = client.get("/accounts/a1")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Test"


def test_get_account_not_found(client: TestClient):
    assert client.get("/accounts/nope").status_code == 404


def test_delete_account(client: TestClient):
    client.post("/accounts", json={"id": "a1", "name": "Test"})
    assert client.delete("/accounts/a1").status_code == 204
    assert client.get("/accounts/a1").status_code == 404


# ─── Instrument endpoints ────────────────────────────────────


def test_list_instruments_empty(client: TestClient):
    resp = client.get("/instruments")
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_instrument(client: TestClient):
    payload = {"id": "aapl", "ticker": "AAPL", "name": "Apple Inc."}
    resp = client.post("/instruments", json=payload)
    assert resp.status_code == 201
    assert resp.json()["ticker"] == "AAPL"


def test_get_instrument_not_found(client: TestClient):
    assert client.get("/instruments/nope").status_code == 404


def test_delete_instrument(client: TestClient):
    client.post("/instruments", json={"id": "aapl", "ticker": "AAPL", "name": "Apple"})
    assert client.delete("/instruments/aapl").status_code == 204
    assert client.get("/instruments/aapl").status_code == 404


# ─── Transaction endpoints ───────────────────────────────────


def test_list_transactions_empty(client: TestClient):
    assert client.get("/transactions").json() == []


def test_create_transaction(client: TestClient):
    # Set up account + instrument first
    client.post("/accounts", json={"id": "a1", "name": "Schwab"})
    client.post("/instruments", json={"id": "aapl", "ticker": "AAPL", "name": "Apple"})
    payload = {
        "id": "t1",
        "account_id": "a1",
        "instrument_id": "aapl",
        "type": "buy",
        "quantity": 10,
        "price": 150.0,
        "date": "2024-01-15",
    }
    resp = client.post("/transactions", json=payload)
    assert resp.status_code == 201
    assert resp.json()["id"] == "t1"
    assert resp.json()["type"] == "buy"


def test_list_transactions_filter_by_account(client: TestClient):
    client.post("/accounts", json={"id": "a1", "name": "Schwab"})
    client.post("/accounts", json={"id": "a2", "name": "Fidelity"})
    client.post("/instruments", json={"id": "aapl", "ticker": "AAPL", "name": "Apple"})
    client.post(
        "/transactions",
        json={
            "id": "t1",
            "account_id": "a1",
            "instrument_id": "aapl",
            "type": "buy",
            "quantity": 10,
            "price": 150,
            "date": "2024-01-01",
        },
    )
    client.post(
        "/transactions",
        json={
            "id": "t2",
            "account_id": "a2",
            "instrument_id": "aapl",
            "type": "buy",
            "quantity": 5,
            "price": 160,
            "date": "2024-02-01",
        },
    )
    resp = client.get("/transactions", params={"account_id": "a1"})
    assert len(resp.json()) == 1
    assert resp.json()[0]["account_id"] == "a1"


def test_sell_validation_400(client: TestClient):
    """Selling more than available returns 400."""
    client.post("/accounts", json={"id": "a1", "name": "Schwab"})
    client.post("/instruments", json={"id": "aapl", "ticker": "AAPL", "name": "Apple"})
    resp = client.post(
        "/transactions",
        json={
            "id": "s1",
            "account_id": "a1",
            "instrument_id": "aapl",
            "type": "sell",
            "quantity": 10,
            "price": 150,
            "date": "2024-06-01",
        },
    )
    assert resp.status_code == 400
    assert "Cannot sell" in resp.json()["detail"]


def test_delete_transaction(client: TestClient):
    client.post("/accounts", json={"id": "a1", "name": "Schwab"})
    client.post("/instruments", json={"id": "aapl", "ticker": "AAPL", "name": "Apple"})
    client.post(
        "/transactions",
        json={
            "id": "t1",
            "account_id": "a1",
            "instrument_id": "aapl",
            "type": "buy",
            "quantity": 10,
            "price": 150,
            "date": "2024-01-01",
        },
    )
    assert client.delete("/transactions/t1").status_code == 204
    assert client.get("/transactions/t1").status_code == 404


# ─── Positions (computed) ────────────────────────────────────


def test_positions_empty(client: TestClient):
    assert client.get("/positions").json() == []


def test_positions_after_buy(client: TestClient):
    client.post("/accounts", json={"id": "a1", "name": "Schwab"})
    client.post("/instruments", json={"id": "aapl", "ticker": "AAPL", "name": "Apple"})
    client.post(
        "/transactions",
        json={
            "id": "t1",
            "account_id": "a1",
            "instrument_id": "aapl",
            "type": "buy",
            "quantity": 10,
            "price": 100,
            "date": "2024-01-01",
        },
    )
    resp = client.get("/positions")
    assert resp.status_code == 200
    positions = resp.json()
    assert len(positions) == 1
    p = positions[0]
    assert p["instrument_id"] == "aapl"
    assert p["quantity"] == 10
    assert p["cost_basis"] == 1000.0
    assert p["current_price"] == 150.0
    assert p["market_value"] == 1500.0
    assert p["unrealized_gain"] == 500.0


def test_positions_filter_by_account(client: TestClient):
    client.post("/accounts", json={"id": "a1", "name": "Schwab"})
    client.post("/accounts", json={"id": "a2", "name": "Fidelity"})
    client.post("/instruments", json={"id": "aapl", "ticker": "AAPL", "name": "Apple"})
    client.post(
        "/transactions",
        json={
            "id": "t1",
            "account_id": "a1",
            "instrument_id": "aapl",
            "type": "buy",
            "quantity": 10,
            "price": 100,
            "date": "2024-01-01",
        },
    )
    client.post(
        "/transactions",
        json={
            "id": "t2",
            "account_id": "a2",
            "instrument_id": "aapl",
            "type": "buy",
            "quantity": 5,
            "price": 110,
            "date": "2024-02-01",
        },
    )
    resp = client.get("/positions", params={"account_id": "a1"})
    positions = resp.json()
    assert len(positions) == 1
    assert positions[0]["account_id"] == "a1"
    assert positions[0]["quantity"] == 10


# ─── Capital gains (computed) ────────────────────────────────


def test_gains_empty(client: TestClient):
    assert client.get("/gains").json() == []


def test_gains_after_sell(client: TestClient):
    client.post("/accounts", json={"id": "a1", "name": "Schwab"})
    client.post("/instruments", json={"id": "aapl", "ticker": "AAPL", "name": "Apple"})
    client.post(
        "/transactions",
        json={
            "id": "t1",
            "account_id": "a1",
            "instrument_id": "aapl",
            "type": "buy",
            "quantity": 10,
            "price": 100,
            "date": "2024-01-01",
        },
    )
    client.post(
        "/transactions",
        json={
            "id": "s1",
            "account_id": "a1",
            "instrument_id": "aapl",
            "type": "sell",
            "quantity": 5,
            "price": 150,
            "date": "2024-06-01",
        },
    )
    resp = client.get("/gains")
    gains = resp.json()
    assert len(gains) == 1
    assert gains[0]["quantity"] == 5
    assert gains[0]["gain"] == 250.0


# ─── Portfolio history (computed) ─────────────────────────────


def test_history_empty(client: TestClient):
    assert client.get("/history").json() == []


def test_history_after_transactions(client: TestClient):
    client.post("/accounts", json={"id": "a1", "name": "Schwab"})
    client.post("/instruments", json={"id": "aapl", "ticker": "AAPL", "name": "Apple"})
    client.post(
        "/transactions",
        json={
            "id": "t1",
            "account_id": "a1",
            "instrument_id": "aapl",
            "type": "buy",
            "quantity": 10,
            "price": 100,
            "date": "2024-01-01",
        },
    )
    resp = client.get("/history")
    history = resp.json()
    assert len(history) >= 1
    assert history[0]["date"] == "2024-01-01"
    assert history[0]["cost_basis"] == 1000.0


# ─── Round-trip flows ─────────────────────────────────────────


def test_full_portfolio_roundtrip(client: TestClient):
    """Create account + instrument, buy, sell, check positions + gains."""
    client.post("/accounts", json={"id": "a1", "name": "Schwab"})
    client.post("/instruments", json={"id": "aapl", "ticker": "AAPL", "name": "Apple"})

    # Buy 10 @ 100
    client.post(
        "/transactions",
        json={
            "id": "t1",
            "account_id": "a1",
            "instrument_id": "aapl",
            "type": "buy",
            "quantity": 10,
            "price": 100,
            "date": "2024-01-01",
        },
    )

    # Sell 5 @ 150
    client.post(
        "/transactions",
        json={
            "id": "s1",
            "account_id": "a1",
            "instrument_id": "aapl",
            "type": "sell",
            "quantity": 5,
            "price": 150,
            "date": "2024-06-01",
        },
    )

    # Positions: 5 shares remaining
    positions = client.get("/positions").json()
    assert len(positions) == 1
    assert positions[0]["quantity"] == 5
    assert positions[0]["cost_basis"] == 500.0

    # Gains: realized gain of 250
    gains = client.get("/gains").json()
    assert len(gains) == 1
    assert gains[0]["gain"] == 250.0


def test_fixture_isolates_state_between_tests(client: TestClient):
    """Regression guard: each test starts with empty repos."""
    assert client.get("/accounts").json() == []
    assert client.get("/instruments").json() == []
    assert client.get("/transactions").json() == []
