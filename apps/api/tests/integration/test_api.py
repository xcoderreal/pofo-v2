"""API integration tests.

Uses FastAPI's dependency_overrides to inject fake repositories. Each test
gets fresh repo instances that persist across requests within the test, so
round-trip flows (POST -> GET -> list) work as they would against a real store.
"""

import pytest
from fastapi.testclient import TestClient

from myapp.domain.model import AssetClass, Instrument
from myapp.entrypoints.api import app, get_instrument_repo
from tests.fake_repository import FakeInstrumentRepository


@pytest.fixture
def repo() -> FakeInstrumentRepository:
    return FakeInstrumentRepository()


@pytest.fixture
def client(repo: FakeInstrumentRepository) -> TestClient:
    # Return the same repo for every request in this test.
    app.dependency_overrides[get_instrument_repo] = lambda: repo
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def seeded_client(repo: FakeInstrumentRepository) -> TestClient:
    for instrument in [
        Instrument(
            id="r1", symbol="GOOG", name="Alphabet", asset_class=AssetClass.EQUITY
        ),
        Instrument(
            id="r2", symbol="BTC", name="Bitcoin", asset_class=AssetClass.CRYPTO
        ),
    ]:
        repo.add(instrument)
    app.dependency_overrides[get_instrument_repo] = lambda: repo
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


# ─── Read-only endpoints ───────────────────────────────────────────


def test_list_instruments_empty(client: TestClient):
    resp = client.get("/instruments")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_instruments_seeded(seeded_client: TestClient):
    resp = seeded_client.get("/instruments")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_get_instrument(seeded_client: TestClient):
    resp = seeded_client.get("/instruments/r1")
    assert resp.status_code == 200
    assert resp.json()["symbol"] == "GOOG"


def test_get_instrument_not_found(client: TestClient):
    resp = client.get("/instruments/nonexistent")
    assert resp.status_code == 404


def test_health(client: TestClient):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# ─── Write endpoints ────────────────────────────────────────────────


def test_create_instrument(client: TestClient):
    payload = {"id": "r3", "symbol": "aapl", "name": "Apple", "asset_class": "equity"}
    resp = client.post("/instruments", json=payload)
    assert resp.status_code == 201
    body = resp.json()
    assert body["id"] == "r3"
    assert body["symbol"] == "AAPL"  # normalized uppercase
    assert body["name"] == "Apple"
    assert body["asset_class"] == "equity"


def test_create_instrument_missing_required_field(client: TestClient):
    resp = client.post("/instruments", json={"symbol": "AAPL", "name": "Apple"})
    assert resp.status_code == 422


def test_create_instrument_invalid_asset_class(client: TestClient):
    resp = client.post(
        "/instruments",
        json={"id": "r5", "symbol": "AAPL", "name": "Apple", "asset_class": "bond"},
    )
    assert resp.status_code == 422


def test_create_instrument_duplicate_symbol_rejected(client: TestClient):
    payload = {"id": "r6", "symbol": "AAPL", "name": "Apple", "asset_class": "equity"}
    client.post("/instruments", json=payload)
    resp = client.post(
        "/instruments",
        json={
            "id": "r7",
            "symbol": "aapl",
            "name": "Apple Inc",
            "asset_class": "equity",
        },
    )
    assert resp.status_code == 409


def test_create_instrument_duplicate_id_rejected_even_with_different_symbol(
    client: TestClient,
):
    client.post(
        "/instruments",
        json={
            "id": "dup-id",
            "symbol": "AAPL",
            "name": "Apple",
            "asset_class": "equity",
        },
    )
    resp = client.post(
        "/instruments",
        json={
            "id": "dup-id",
            "symbol": "MSFT",
            "name": "Microsoft",
            "asset_class": "equity",
        },
    )
    assert resp.status_code == 409


# ─── Round-trip integration flows ──────────────────────────────────


def test_post_then_list_roundtrip(client: TestClient):
    payload = {
        "id": "hello",
        "symbol": "SOXL",
        "name": "Direxion Semis",
        "asset_class": "etf",
    }
    post_resp = client.post("/instruments", json=payload)
    assert post_resp.status_code == 201

    list_resp = client.get("/instruments")
    assert list_resp.status_code == 200
    instruments = list_resp.json()
    assert len(instruments) == 1
    assert instruments[0] == payload


def test_post_then_get_by_id_roundtrip(client: TestClient):
    payload = {
        "id": "hello",
        "symbol": "BTC",
        "name": "Bitcoin",
        "asset_class": "crypto",
    }
    client.post("/instruments", json=payload)

    resp = client.get("/instruments/hello")
    assert resp.status_code == 200
    assert resp.json() == payload


def test_fixture_isolates_state_between_tests(client: TestClient):
    """Regression guard: each test starts with an empty repo."""
    assert client.get("/instruments").json() == []
    client.post(
        "/instruments",
        json={"id": "leak", "symbol": "LEAK", "name": "leak", "asset_class": "equity"},
    )
    assert len(client.get("/instruments").json()) == 1
    # Next test should still see an empty repo — enforced by fresh fixture.
