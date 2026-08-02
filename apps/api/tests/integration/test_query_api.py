import pytest
from fastapi.testclient import TestClient

from myapp.adapters.supabase_auth_provider import SupabaseAuthProvider
from myapp.domain.model import Account, AccountType, AssetClass, Instrument, User
from myapp.entrypoints.api import (
    app,
    get_account_repo,
    get_auth_provider,
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

ACCOUNT = Account(
    id="acc1",
    user_id="user-a",
    name="Brokerage",
    institution="Fidelity",
    account_type=AccountType.BROKERAGE,
)
GOOG = Instrument(
    id="goog", symbol="GOOG", name="Alphabet", asset_class=AssetClass.EQUITY
)


@pytest.fixture
def transaction_repo() -> FakeTransactionRepository:
    return FakeTransactionRepository()


def _client_as(user_id: str, transaction_repo: FakeTransactionRepository) -> TestClient:
    app.dependency_overrides[get_transaction_repo] = lambda: transaction_repo
    app.dependency_overrides[get_instrument_repo] = lambda: FakeInstrumentRepository(
        [GOOG]
    )
    app.dependency_overrides[get_account_repo] = lambda: FakeAccountRepository(
        [ACCOUNT]
    )
    app.dependency_overrides[get_price_source] = lambda: FakePriceSource()
    app.dependency_overrides[get_price_history_repo] = FakePriceHistoryRepository
    app.dependency_overrides[get_current_user] = lambda: User(id=user_id)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_share_count_round_trip(transaction_repo: FakeTransactionRepository) -> None:
    client = _client_as("user-a", transaction_repo)
    client.post(
        "/transactions/deposit",
        json={
            "account_id": "acc1",
            "amount": "10000",
            "timestamp": "2025-12-31T00:00:00",
        },
    )
    client.post(
        "/transactions",
        json={
            "account_id": "acc1",
            "instrument_id": "goog",
            "type": "buy",
            "quantity": "10",
            "price": "100",
            "timestamp": "2026-01-01T00:00:00",
        },
    )

    resp = client.get(
        "/portfolio/query",
        params={
            "metric": "share_count",
            "instruments": ["goog"],
            "accounts": ["acc1"],
            "group_by": "none",
            "start": "2026-01-01",
            "end": "2026-01-05",
            "granularity": "daily",
            "mode": "point_in_time",
        },
    )

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["group"] == "total"
    assert body[0]["points"][0]["value"] == "10"


def test_invalid_metric_mode_pair_returns_400(
    transaction_repo: FakeTransactionRepository,
) -> None:
    client = _client_as("user-a", transaction_repo)

    resp = client.get(
        "/portfolio/query",
        params={
            "metric": "share_count",
            "start": "2026-01-01",
            "end": "2026-01-05",
            "granularity": "daily",
            "mode": "cumulative",
        },
    )

    assert resp.status_code == 400


def test_accounts_with_market_price_returns_400(
    transaction_repo: FakeTransactionRepository,
) -> None:
    client = _client_as("user-a", transaction_repo)

    resp = client.get(
        "/portfolio/query",
        params={
            "metric": "market_price",
            "instruments": ["goog"],
            "accounts": ["acc1"],
            "start": "2026-01-01",
            "end": "2026-01-05",
            "granularity": "daily",
            "mode": "point_in_time",
        },
    )

    assert resp.status_code == 400


def test_market_price_without_accounts_succeeds(
    transaction_repo: FakeTransactionRepository,
) -> None:
    client = _client_as("user-a", transaction_repo)

    resp = client.get(
        "/portfolio/query",
        params={
            "metric": "market_price",
            "instruments": ["goog"],
            "start": "2026-01-01",
            "end": "2026-01-05",
            "granularity": "daily",
            "mode": "point_in_time",
        },
    )

    assert resp.status_code == 200
    assert resp.json() == []  # no price bars stored — sparse, not an error


def test_requires_auth(transaction_repo: FakeTransactionRepository) -> None:
    client = _client_as("user-a", transaction_repo)
    app.dependency_overrides.pop(get_current_user)
    app.dependency_overrides[get_auth_provider] = lambda: SupabaseAuthProvider(
        project_url="https://test.supabase.co"
    )

    resp = client.get(
        "/portfolio/query",
        params={
            "metric": "share_count",
            "start": "2026-01-01",
            "end": "2026-01-05",
            "granularity": "daily",
            "mode": "point_in_time",
        },
    )

    assert resp.status_code == 401


def test_empty_result_when_nothing_matches(
    transaction_repo: FakeTransactionRepository,
) -> None:
    client = _client_as("user-a", transaction_repo)

    resp = client.get(
        "/portfolio/query",
        params={
            "metric": "share_count",
            "instruments": ["goog"],
            "accounts": ["acc1"],
            "start": "2026-01-01",
            "end": "2026-01-05",
            "granularity": "daily",
            "mode": "point_in_time",
        },
    )

    assert resp.status_code == 200
    assert resp.json() == []
