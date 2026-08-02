"""Deposit/Withdrawal API integration tests.

Unlike test_transactions_api.py, the instrument repo here must be shared
across multiple client instances within a single test (not recreated per
call) — CashService auto-provisions the CASH instrument into it on first
use, and a fresh repo per call would lose that between requests.
"""

import pytest
from fastapi.testclient import TestClient

from myapp.domain.model import Account, AccountType, User
from myapp.entrypoints.api import (
    app,
    get_account_repo,
    get_current_user,
    get_instrument_repo,
    get_transaction_repo,
)
from myapp.service.cash_service import CASH_INSTRUMENT_ID
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


@pytest.fixture
def transaction_repo() -> FakeTransactionRepository:
    return FakeTransactionRepository()


@pytest.fixture
def instrument_repo() -> FakeInstrumentRepository:
    return FakeInstrumentRepository()


def _client_as(
    user_id: str,
    transaction_repo: FakeTransactionRepository,
    instrument_repo: FakeInstrumentRepository,
) -> TestClient:
    app.dependency_overrides[get_transaction_repo] = lambda: transaction_repo
    app.dependency_overrides[get_instrument_repo] = lambda: instrument_repo
    app.dependency_overrides[get_account_repo] = lambda: FakeAccountRepository(
        [ACCOUNT]
    )
    app.dependency_overrides[get_current_user] = lambda: User(id=user_id)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_deposit_creates_the_cash_instrument_and_updates_the_position(
    transaction_repo: FakeTransactionRepository,
    instrument_repo: FakeInstrumentRepository,
) -> None:
    client = _client_as("user-a", transaction_repo, instrument_repo)

    resp = client.post(
        "/transactions/deposit",
        json={
            "account_id": "acc1",
            "amount": "500",
            "timestamp": "2026-01-01T00:00:00",
        },
    )
    assert resp.status_code == 201
    assert resp.json()["type"] == "buy"
    assert resp.json()["instrument_id"] == CASH_INSTRUMENT_ID

    position = client.get(f"/accounts/acc1/instruments/{CASH_INSTRUMENT_ID}/position")
    assert position.status_code == 200
    assert position.json()["share_count"] == "500"


def test_withdraw_decreases_the_cash_position(
    transaction_repo: FakeTransactionRepository,
    instrument_repo: FakeInstrumentRepository,
) -> None:
    client = _client_as("user-a", transaction_repo, instrument_repo)
    client.post(
        "/transactions/deposit",
        json={
            "account_id": "acc1",
            "amount": "500",
            "timestamp": "2026-01-01T00:00:00",
        },
    )

    resp = client.post(
        "/transactions/withdraw",
        json={
            "account_id": "acc1",
            "amount": "200",
            "timestamp": "2026-01-02T00:00:00",
        },
    )
    assert resp.status_code == 201

    position = client.get(f"/accounts/acc1/instruments/{CASH_INSTRUMENT_ID}/position")
    assert position.json()["share_count"] == "300"


def test_withdraw_more_than_the_balance_returns_409(
    transaction_repo: FakeTransactionRepository,
    instrument_repo: FakeInstrumentRepository,
) -> None:
    client = _client_as("user-a", transaction_repo, instrument_repo)
    client.post(
        "/transactions/deposit",
        json={
            "account_id": "acc1",
            "amount": "100",
            "timestamp": "2026-01-01T00:00:00",
        },
    )

    resp = client.post(
        "/transactions/withdraw",
        json={
            "account_id": "acc1",
            "amount": "200",
            "timestamp": "2026-01-02T00:00:00",
        },
    )
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["code"] == "insufficient_cash"
    assert detail["requested"] == "200"
    assert detail["available"] == "100"


def test_deposit_against_nonexistent_account_returns_404(
    transaction_repo: FakeTransactionRepository,
    instrument_repo: FakeInstrumentRepository,
) -> None:
    client = _client_as("user-a", transaction_repo, instrument_repo)

    resp = client.post(
        "/transactions/deposit",
        json={
            "account_id": "missing",
            "amount": "100",
            "timestamp": "2026-01-01T00:00:00",
        },
    )
    assert resp.status_code == 404


def test_deposit_rejects_non_positive_amount(
    transaction_repo: FakeTransactionRepository,
    instrument_repo: FakeInstrumentRepository,
) -> None:
    client = _client_as("user-a", transaction_repo, instrument_repo)

    resp = client.post(
        "/transactions/deposit",
        json={"account_id": "acc1", "amount": "0", "timestamp": "2026-01-01T00:00:00"},
    )
    assert resp.status_code == 422


def test_repeated_deposits_do_not_duplicate_the_cash_instrument(
    transaction_repo: FakeTransactionRepository,
    instrument_repo: FakeInstrumentRepository,
) -> None:
    client = _client_as("user-a", transaction_repo, instrument_repo)

    client.post(
        "/transactions/deposit",
        json={
            "account_id": "acc1",
            "amount": "100",
            "timestamp": "2026-01-01T00:00:00",
        },
    )
    client.post(
        "/transactions/deposit",
        json={
            "account_id": "acc1",
            "amount": "200",
            "timestamp": "2026-01-02T00:00:00",
        },
    )

    cash_instruments = [
        i for i in instrument_repo.list_all() if i.id == CASH_INSTRUMENT_ID
    ]
    assert len(cash_instruments) == 1
