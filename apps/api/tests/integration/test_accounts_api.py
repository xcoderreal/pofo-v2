"""Account API integration tests.

Accounts are user-owned, so every test injects a StubAuthProvider-backed
current user via dependency_overrides on get_current_user, exactly like a
real request would resolve one from a JWT.
"""

from datetime import datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from myapp.domain.model import (
    Account,
    AccountType,
    Transaction,
    TransactionType,
    User,
)
from myapp.entrypoints.api import (
    app,
    get_account_repo,
    get_current_user,
    get_transaction_repo,
)
from tests.fake_repository import FakeAccountRepository, FakeTransactionRepository


@pytest.fixture
def repo() -> FakeAccountRepository:
    return FakeAccountRepository()


@pytest.fixture
def transaction_repo() -> FakeTransactionRepository:
    return FakeTransactionRepository()


def _client_as(
    user_id: str,
    repo: FakeAccountRepository,
    transaction_repo: FakeTransactionRepository | None = None,
) -> TestClient:
    app.dependency_overrides[get_account_repo] = lambda: repo
    # AccountService reaches the transaction repo for its cascade delete,
    # so every account route resolves it — overridden here even for the
    # tests that never write a Transaction, because the alternative is
    # falling through to `app.state`, which only exists once some other
    # test has run the lifespan.
    ledger = (
        transaction_repo
        if transaction_repo is not None
        else FakeTransactionRepository()
    )
    app.dependency_overrides[get_transaction_repo] = lambda: ledger
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


# ─── Cascade delete ───────────────────────────────────────────


def _transaction(id: str, account_id: str, **overrides) -> Transaction:
    fields = {
        "id": id,
        "user_id": "user-a",
        "account_id": account_id,
        "instrument_id": "goog",
        "type": TransactionType.BUY,
        "quantity": Decimal(10),
        "price": Decimal(100),
        "timestamp": datetime(2026, 1, 2, 11, 0),
    }
    fields.update(overrides)
    return Transaction(**fields)  # type: ignore[arg-type]


def test_delete_account_removes_it_and_reports_the_transactions_it_took(
    repo: FakeAccountRepository, transaction_repo: FakeTransactionRepository
):
    client = _client_as("user-a", repo, transaction_repo)
    client.post(
        "/accounts",
        json={
            "id": "acc1",
            "name": "Brokerage",
            "institution": "Fidelity",
            "account_type": "brokerage",
        },
    )
    transaction_repo.add(_transaction("t1", "acc1"))
    transaction_repo.add(
        _transaction(
            "t1-cash",
            "acc1",
            instrument_id="cash",
            type=TransactionType.SELL,
            quantity=Decimal(1000),
            price=Decimal(1),
            trade_id="t1",
        )
    )

    resp = client.delete("/accounts/acc1")

    assert resp.status_code == 200
    assert resp.json() == {"transactions_deleted": 2}
    assert client.get("/accounts/acc1").status_code == 404
    assert client.get("/accounts").json() == []
    assert transaction_repo.list_by_account("acc1") == []


def test_delete_account_leaves_another_accounts_ledger_alone(
    repo: FakeAccountRepository, transaction_repo: FakeTransactionRepository
):
    repo.add(
        Account(
            id="acc1",
            user_id="user-a",
            name="Brokerage",
            institution="Fidelity",
            account_type=AccountType.BROKERAGE,
        )
    )
    repo.add(
        Account(
            id="acc2",
            user_id="user-a",
            name="IRA",
            institution="Fidelity",
            account_type=AccountType.IRA,
        )
    )
    transaction_repo.add(_transaction("t1", "acc1"))
    transaction_repo.add(_transaction("t2", "acc2"))

    client = _client_as("user-a", repo, transaction_repo)
    assert client.delete("/accounts/acc1").status_code == 200

    assert [t.id for t in transaction_repo.list_by_account("acc2")] == ["t2"]
    assert [a["id"] for a in client.get("/accounts").json()] == ["acc2"]


def test_delete_account_cross_user_returns_404_and_deletes_nothing(
    repo: FakeAccountRepository, transaction_repo: FakeTransactionRepository
):
    """A delete by id must never be a cross-user delete."""
    repo.add(
        Account(
            id="acc1",
            user_id="user-a",
            name="A's account",
            institution="Fidelity",
            account_type=AccountType.BROKERAGE,
        )
    )
    transaction_repo.add(_transaction("t1", "acc1"))

    resp = _client_as("user-b", repo, transaction_repo).delete("/accounts/acc1")

    assert resp.status_code == 404
    assert repo.get("acc1") is not None
    assert [t.id for t in transaction_repo.list_by_account("acc1")] == ["t1"]


def test_delete_nonexistent_account_returns_404(repo: FakeAccountRepository):
    assert _client_as("user-a", repo).delete("/accounts/nope").status_code == 404
