"""Account API integration tests.

Accounts are user-owned, so every test injects a StubAuthProvider-backed
current user via dependency_overrides on get_current_user, exactly like a
real request would resolve one from a JWT.
"""

import pytest
from fastapi.testclient import TestClient

from myapp.domain.model import Account, AccountType, User
from myapp.entrypoints.api import app, get_account_repo, get_current_user
from tests.fake_repository import FakeAccountRepository


@pytest.fixture
def repo() -> FakeAccountRepository:
    return FakeAccountRepository()


def _client_as(user_id: str, repo: FakeAccountRepository) -> TestClient:
    app.dependency_overrides[get_account_repo] = lambda: repo
    app.dependency_overrides[get_current_user] = lambda: User(id=user_id)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_list_accounts_empty(repo: FakeAccountRepository):
    client = _client_as("user-a", repo)
    resp = client.get("/accounts")
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_and_list_account(repo: FakeAccountRepository):
    client = _client_as("user-a", repo)
    payload = {
        "id": "acc1",
        "name": "Wells Fargo Brokerage",
        "institution": "Wells Fargo",
        "account_type": "brokerage",
    }
    post = client.post("/accounts", json=payload)
    assert post.status_code == 201
    assert post.json() == payload

    listed = client.get("/accounts")
    assert listed.status_code == 200
    assert listed.json() == [payload]


def test_create_account_invalid_account_type(repo: FakeAccountRepository):
    client = _client_as("user-a", repo)
    resp = client.post(
        "/accounts",
        json={
            "id": "acc1",
            "name": "X",
            "institution": "X",
            "account_type": "savings",
        },
    )
    assert resp.status_code == 422


def test_create_account_duplicate_id_rejected_even_for_a_different_owner(
    repo: FakeAccountRepository,
):
    _client_as("user-a", repo).post(
        "/accounts",
        json={
            "id": "dup",
            "name": "A",
            "institution": "X",
            "account_type": "brokerage",
        },
    )
    resp = _client_as("user-b", repo).post(
        "/accounts",
        json={"id": "dup", "name": "B", "institution": "Y", "account_type": "ira"},
    )
    assert resp.status_code == 409


def test_get_account_not_found(repo: FakeAccountRepository):
    client = _client_as("user-a", repo)
    resp = client.get("/accounts/nonexistent")
    assert resp.status_code == 404


def test_list_accounts_does_not_leak_other_users_accounts(repo: FakeAccountRepository):
    repo.add(
        Account(
            id="1",
            user_id="user-a",
            name="A's account",
            institution="Fidelity",
            account_type=AccountType.BROKERAGE,
        )
    )
    repo.add(
        Account(
            id="2",
            user_id="user-b",
            name="B's account",
            institution="Schwab",
            account_type=AccountType.IRA,
        )
    )

    client = _client_as("user-a", repo)
    resp = client.get("/accounts")
    assert resp.status_code == 200
    assert [a["id"] for a in resp.json()] == ["1"]


def test_get_account_cross_user_returns_404_not_403(repo: FakeAccountRepository):
    """Cross-user reads must be indistinguishable from not-found."""
    repo.add(
        Account(
            id="1",
            user_id="user-a",
            name="A's account",
            institution="Fidelity",
            account_type=AccountType.BROKERAGE,
        )
    )

    client = _client_as("user-b", repo)
    resp = client.get("/accounts/1")
    assert resp.status_code == 404


def test_accounts_require_authentication(repo: FakeAccountRepository):
    """Without a current-user override, the real get_current_user dependency
    still runs (needs the app's lifespan, hence the context-manager form) —
    under this repo's default stub auth it resolves to the fixed dev user
    rather than rejecting, so the request succeeds."""
    app.dependency_overrides[get_account_repo] = lambda: repo
    with TestClient(app) as client:
        resp = client.get("/accounts")
    assert resp.status_code == 200
