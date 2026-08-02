"""Integration coverage for /portfolio/summary.

The dashboard's "Max" range is defined as "resolved to the earliest
transaction" (docs/design/dashboard_v2/behaviour.md § Ranges and
granularity). With nothing exposing that date the client fell back to
`start = end = today`, so Max charted a single point labelled "all time".
"""

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
    get_transaction_repo,
)
from tests.fake_repository import (
    FakeAccountRepository,
    FakeInstrumentRepository,
    FakeTransactionRepository,
)

BROKERAGE = Account(
    id="acc1",
    user_id="user-a",
    name="Brokerage",
    institution="Fidelity",
    account_type=AccountType.BROKERAGE,
)
IRA = Account(
    id="acc2",
    user_id="user-a",
    name="IRA",
    institution="Fidelity",
    account_type=AccountType.IRA,
)
GOOG = Instrument(
    id="goog", symbol="GOOG", name="Alphabet", asset_class=AssetClass.EQUITY
)


@pytest.fixture
def client() -> TestClient:
    # One repo instance per test, not one per request — state has to
    # persist across the requests a single test makes, and not a step
    # further (tests/integration/test_api.py's fixture convention).
    transaction_repo = FakeTransactionRepository()
    instrument_repo = FakeInstrumentRepository([GOOG])
    account_repo = FakeAccountRepository([BROKERAGE, IRA])
    app.dependency_overrides[get_transaction_repo] = lambda: transaction_repo
    app.dependency_overrides[get_instrument_repo] = lambda: instrument_repo
    app.dependency_overrides[get_account_repo] = lambda: account_repo
    app.dependency_overrides[get_current_user] = lambda: User(id="user-a")
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _deposit(client: TestClient, account_id: str, timestamp: str) -> None:
    resp = client.post(
        "/transactions/deposit",
        json={"account_id": account_id, "amount": "10000", "timestamp": timestamp},
    )
    assert resp.status_code == 201, resp.text


def test_an_empty_portfolio_has_no_earliest_date(client: TestClient) -> None:
    resp = client.get("/portfolio/summary")

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"earliest_transaction_date": None}


def test_reports_the_first_day_across_every_account(client: TestClient) -> None:
    _deposit(client, "acc1", "2026-03-04T00:00:00")
    _deposit(client, "acc2", "2024-07-09T00:00:00")
    _deposit(client, "acc1", "2025-01-01T00:00:00")

    resp = client.get("/portfolio/summary")

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"earliest_transaction_date": "2024-07-09"}


def test_counts_a_trades_paired_cash_leg(client: TestClient) -> None:
    """A trade writes two rows and the CASH leg carries the same
    timestamp, so this is really asserting the two never disagree."""
    _deposit(client, "acc1", "2026-01-01T00:00:00")
    resp = client.post(
        "/transactions",
        json={
            "account_id": "acc1",
            "instrument_id": "goog",
            "type": "buy",
            "quantity": "10",
            "price": "100",
            "timestamp": "2026-02-01T00:00:00",
        },
    )
    assert resp.status_code == 201, resp.text

    resp = client.get("/portfolio/summary")

    assert resp.json() == {"earliest_transaction_date": "2026-01-01"}


def test_another_users_ledger_is_invisible(client: TestClient) -> None:
    _deposit(client, "acc1", "2024-07-09T00:00:00")
    app.dependency_overrides[get_current_user] = lambda: User(id="user-b")

    resp = TestClient(app).get("/portfolio/summary")

    assert resp.json() == {"earliest_transaction_date": None}


def test_requires_auth(client: TestClient) -> None:
    app.dependency_overrides.pop(get_current_user)
    app.dependency_overrides[get_auth_provider] = lambda: SupabaseAuthProvider(
        project_url="https://test.supabase.co"
    )

    resp = client.get("/portfolio/summary")

    assert resp.status_code == 401
