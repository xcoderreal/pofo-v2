"""Transaction/Position API integration tests.

Mirrors test_accounts_api.py's dependency_overrides pattern, plus a
fixed Account and Instrument seeded via their own repos so transactions
have something valid to reference.
"""

import pytest
from fastapi.testclient import TestClient

from myapp.domain.model import Account, AccountType, AssetClass, Instrument, User
from myapp.entrypoints.api import (
    app,
    get_account_repo,
    get_current_user,
    get_instrument_repo,
    get_transaction_repo,
)
from tests.fake_repository import (
    FakeAccountRepository,
    FakeInstrumentRepository,
    FakeTransactionRepository,
)

ACCOUNT = Account(
    id="acc1",
    user_id="user-a",
    name="Brokerage",
    institution="Fidelity",
    account_type=AccountType.BROKERAGE,
)
INSTRUMENT = Instrument(
    id="goog", symbol="GOOG", name="Alphabet", asset_class=AssetClass.EQUITY
)


@pytest.fixture
def transaction_repo() -> FakeTransactionRepository:
    return FakeTransactionRepository()


def _client_as(user_id: str, transaction_repo: FakeTransactionRepository) -> TestClient:
    app.dependency_overrides[get_transaction_repo] = lambda: transaction_repo
    app.dependency_overrides[get_account_repo] = lambda: FakeAccountRepository(
        [ACCOUNT]
    )
    app.dependency_overrides[get_instrument_repo] = lambda: FakeInstrumentRepository(
        [INSTRUMENT]
    )
    app.dependency_overrides[get_current_user] = lambda: User(id=user_id)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _buy_payload(**overrides: object) -> dict:
    payload = {
        "account_id": "acc1",
        "instrument_id": "goog",
        "type": "buy",
        "quantity": "10",
        "price": "100",
        "timestamp": "2026-01-01T00:00:00",
    }
    payload.update(overrides)
    return payload


def _deposit(client: TestClient, amount: str = "10000", account_id: str = "acc1"):
    client.post(
        "/transactions/deposit",
        json={
            "account_id": account_id,
            "amount": amount,
            "timestamp": "2025-12-31T00:00:00",
        },
    )


def test_log_buy_then_position_reflects_it(transaction_repo: FakeTransactionRepository):
    client = _client_as("user-a", transaction_repo)
    _deposit(client)  # funds the buy below — a trade now debits cash

    post = client.post("/transactions", json=_buy_payload())
    assert post.status_code == 201
    assert post.json()["type"] == "buy"

    position = client.get("/accounts/acc1/instruments/goog/position")
    assert position.status_code == 200
    assert position.json() == {
        "account_id": "acc1",
        "instrument_id": "goog",
        "share_count": "10",
        "cost_basis": "1000",
    }


def test_position_is_zero_before_any_transaction(
    transaction_repo: FakeTransactionRepository,
):
    client = _client_as("user-a", transaction_repo)

    resp = client.get("/accounts/acc1/instruments/goog/position")

    assert resp.status_code == 200
    assert resp.json()["share_count"] == "0"


def test_selling_more_than_held_returns_409(
    transaction_repo: FakeTransactionRepository,
):
    client = _client_as("user-a", transaction_repo)
    _deposit(client)
    client.post("/transactions", json=_buy_payload(quantity="5"))

    resp = client.post(
        "/transactions",
        json=_buy_payload(type="sell", quantity="10", timestamp="2026-01-02T00:00:00"),
    )

    assert resp.status_code == 409


def test_transaction_against_nonexistent_account_returns_404(
    transaction_repo: FakeTransactionRepository,
):
    client = _client_as("user-a", transaction_repo)

    resp = client.post("/transactions", json=_buy_payload(account_id="missing"))

    assert resp.status_code == 404


def test_transaction_against_another_users_account_returns_404(
    transaction_repo: FakeTransactionRepository,
):
    client = _client_as("user-b", transaction_repo)  # acc1 is owned by user-a

    resp = client.post("/transactions", json=_buy_payload())

    assert resp.status_code == 404


def test_transaction_against_nonexistent_instrument_returns_404(
    transaction_repo: FakeTransactionRepository,
):
    client = _client_as("user-a", transaction_repo)

    resp = client.post("/transactions", json=_buy_payload(instrument_id="missing"))

    assert resp.status_code == 404


def test_position_for_another_users_account_returns_404(
    transaction_repo: FakeTransactionRepository,
):
    setup_client = _client_as("user-a", transaction_repo)
    _deposit(setup_client)
    setup_client.post("/transactions", json=_buy_payload())

    client_b = _client_as("user-b", transaction_repo)
    resp = client_b.get("/accounts/acc1/instruments/goog/position")

    assert resp.status_code == 404


def test_invalid_transaction_type_returns_422(
    transaction_repo: FakeTransactionRepository,
):
    client = _client_as("user-a", transaction_repo)

    resp = client.post("/transactions", json=_buy_payload(type="short"))

    assert resp.status_code == 422
