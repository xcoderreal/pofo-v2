"""Demo-seed API integration tests.

All three repos are shared across client instances within a test — the
seed writes accounts, instruments and transactions in one call and later
requests have to see all of it, which a fresh repo per call would lose.
"""

import pytest
from fastapi.testclient import TestClient

from myapp.domain.model import Account, AccountType, User
from myapp.entrypoints.api import (
    app,
    get_account_repo,
    get_current_user,
    get_instrument_repo,
    get_price_history_repo,
    get_price_source,
    get_transaction_repo,
)
from tests.fake_price_source import FakePriceSource
from tests.fake_repository import (
    FakeAccountRepository,
    FakeInstrumentRepository,
    FakePriceHistoryRepository,
    FakeTransactionRepository,
)


@pytest.fixture
def account_repo() -> FakeAccountRepository:
    return FakeAccountRepository()


@pytest.fixture
def instrument_repo() -> FakeInstrumentRepository:
    return FakeInstrumentRepository()


@pytest.fixture
def transaction_repo() -> FakeTransactionRepository:
    return FakeTransactionRepository()


@pytest.fixture
def client(
    account_repo: FakeAccountRepository,
    instrument_repo: FakeInstrumentRepository,
    transaction_repo: FakeTransactionRepository,
) -> TestClient:
    app.dependency_overrides[get_account_repo] = lambda: account_repo
    app.dependency_overrides[get_instrument_repo] = lambda: instrument_repo
    app.dependency_overrides[get_transaction_repo] = lambda: transaction_repo
    app.dependency_overrides[get_current_user] = lambda: User(id="user-a")
    # Seeding itself never touches the price source, but the query the
    # seeded portfolio is asserted against does.
    app.dependency_overrides[get_price_source] = lambda: FakePriceSource()
    app.dependency_overrides[get_price_history_repo] = FakePriceHistoryRepository
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_seeds_a_fresh_user(client: TestClient) -> None:
    resp = client.post("/demo/seed")

    assert resp.status_code == 200
    assert resp.json() == {"seeded": True}


def test_seeded_accounts_are_immediately_listable(client: TestClient) -> None:
    client.post("/demo/seed")

    resp = client.get("/accounts")

    assert resp.status_code == 200
    assert len(resp.json()) >= 2


def test_seeding_twice_is_a_no_op(client: TestClient) -> None:
    client.post("/demo/seed")
    accounts_after_first = client.get("/accounts").json()

    resp = client.post("/demo/seed")

    assert resp.json() == {"seeded": False}
    assert client.get("/accounts").json() == accounts_after_first


def test_a_user_with_an_account_is_never_seeded_over(
    account_repo: FakeAccountRepository, client: TestClient
) -> None:
    account_repo.add(
        Account(
            id="mine",
            user_id="user-a",
            name="My Own Account",
            institution="Schwab",
            account_type=AccountType.BROKERAGE,
        )
    )

    resp = client.post("/demo/seed")

    assert resp.json() == {"seeded": False}
    assert [a["id"] for a in client.get("/accounts").json()] == ["mine"]


def test_seeded_portfolio_answers_a_query(client: TestClient) -> None:
    """The point of seeding: the dashboard's default view has data.
    Equity over the whole portfolio should resolve without error."""
    client.post("/demo/seed")

    resp = client.get(
        "/portfolio/query",
        params={
            "metric": "equity",
            "group_by": "none",
            "start": "2024-01-01",
            "end": "2026-12-31",
            "granularity": "monthly",
            "mode": "point_in_time",
        },
    )

    assert resp.status_code == 200
