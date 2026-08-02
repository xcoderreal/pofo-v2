"""Integration coverage for the batched positions endpoint — its
response shaping, its scope params and its auth requirement.

Uses FakePriceSource via dependency_overrides, so the price-derived
fields (market_value, unrealized_gain) are pinned to exact numbers here
rather than being left unasserted the way the network-free e2e tier has
to leave them.
"""

from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from myapp.adapters.supabase_auth_provider import SupabaseAuthProvider
from myapp.domain.model import Account, AccountType, AssetClass, Instrument, User
from myapp.domain.price import PriceBar
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
TSLA = Instrument(id="tsla", symbol="TSLA", name="Tesla", asset_class=AssetClass.EQUITY)

# Far enough forward that PriceService's 7-day "latest price" lookback,
# which is anchored on the real clock, still covers it.
TODAY = date.today()


@pytest.fixture
def transaction_repo() -> FakeTransactionRepository:
    return FakeTransactionRepository()


def _client_as(user_id: str, transaction_repo: FakeTransactionRepository) -> TestClient:
    app.dependency_overrides[get_transaction_repo] = lambda: transaction_repo
    instrument_repo = FakeInstrumentRepository([GOOG, TSLA])
    app.dependency_overrides[get_instrument_repo] = lambda: instrument_repo
    app.dependency_overrides[get_account_repo] = lambda: FakeAccountRepository(
        [BROKERAGE, IRA]
    )
    app.dependency_overrides[get_price_source] = lambda: FakePriceSource(
        {"GOOG": [PriceBar(date=TODAY, close=Decimal("130"))]}
    )
    price_history_repo = FakePriceHistoryRepository()
    app.dependency_overrides[get_price_history_repo] = lambda: price_history_repo
    app.dependency_overrides[get_current_user] = lambda: User(id=user_id)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _deposit(client: TestClient, account_id: str, amount: str) -> None:
    resp = client.post(
        "/transactions/deposit",
        json={
            "account_id": account_id,
            "amount": amount,
            "timestamp": "2025-12-31T00:00:00",
        },
    )
    assert resp.status_code == 201, resp.text


def _trade(
    client: TestClient,
    account_id: str,
    instrument_id: str,
    kind: str,
    quantity: str,
    price: str,
    timestamp: str,
) -> None:
    resp = client.post(
        "/transactions",
        json={
            "account_id": account_id,
            "instrument_id": instrument_id,
            "type": kind,
            "quantity": quantity,
            "price": price,
            "timestamp": timestamp,
        },
    )
    assert resp.status_code == 201, resp.text


def _by_key(body: list[dict]) -> dict[tuple[str, str], dict]:
    return {(r["account_id"], r["instrument_id"]): r for r in body}


def test_round_trip_returns_every_field_for_a_logged_buy(
    transaction_repo: FakeTransactionRepository,
) -> None:
    client = _client_as("user-a", transaction_repo)
    _deposit(client, "acc1", "10000")
    _trade(client, "acc1", "goog", "buy", "10", "100", "2026-01-01T00:00:00")

    resp = client.get("/portfolio/positions")

    assert resp.status_code == 200, resp.text
    row = _by_key(resp.json())[("acc1", "goog")]
    assert row == {
        "account_id": "acc1",
        "instrument_id": "goog",
        "share_count": "10",
        "cost_basis": "1000",
        "average_cost": "100",
        "market_value": "1300",
        "realized_gain": "0",
        "unrealized_gain": "300",
    }


def test_cash_row_is_returned_alongside_the_instrument_row(
    transaction_repo: FakeTransactionRepository,
) -> None:
    client = _client_as("user-a", transaction_repo)
    _deposit(client, "acc1", "10000")
    _trade(client, "acc1", "goog", "buy", "10", "100", "2026-01-01T00:00:00")

    body = _by_key(client.get("/portfolio/positions").json())

    assert body[("acc1", "cash")]["share_count"] == "9000"
    assert body[("acc1", "cash")]["market_value"] == "9000"


def test_a_closed_position_comes_back_with_realized_gain_and_null_average_cost(
    transaction_repo: FakeTransactionRepository,
) -> None:
    client = _client_as("user-a", transaction_repo)
    _deposit(client, "acc1", "10000")
    _trade(client, "acc1", "tsla", "buy", "10", "100", "2026-01-01T00:00:00")
    _trade(client, "acc1", "tsla", "sell", "10", "150", "2026-01-02T00:00:00")

    row = _by_key(client.get("/portfolio/positions").json())[("acc1", "tsla")]

    assert row["share_count"] == "0"
    assert row["realized_gain"] == "500"
    assert row["average_cost"] is None
    assert row["market_value"] == "0"


def test_missing_price_history_serializes_as_null_not_zero(
    transaction_repo: FakeTransactionRepository,
) -> None:
    """TSLA has no bars in the fake source — the client must be able to
    tell "no price yet" from "worth nothing"."""
    client = _client_as("user-a", transaction_repo)
    _deposit(client, "acc1", "10000")
    _trade(client, "acc1", "tsla", "buy", "5", "200", "2026-01-01T00:00:00")

    row = _by_key(client.get("/portfolio/positions").json())[("acc1", "tsla")]

    assert row["market_value"] is None
    assert row["unrealized_gain"] is None
    assert row["cost_basis"] == "1000"


def test_accounts_param_scopes_the_result(
    transaction_repo: FakeTransactionRepository,
) -> None:
    client = _client_as("user-a", transaction_repo)
    _deposit(client, "acc1", "10000")
    _deposit(client, "acc2", "10000")

    resp = client.get("/portfolio/positions", params={"accounts": ["acc2"]})

    assert resp.status_code == 200
    assert {r["account_id"] for r in resp.json()} == {"acc2"}


def test_instruments_param_scopes_the_result(
    transaction_repo: FakeTransactionRepository,
) -> None:
    client = _client_as("user-a", transaction_repo)
    _deposit(client, "acc1", "10000")
    _trade(client, "acc1", "goog", "buy", "10", "100", "2026-01-01T00:00:00")

    resp = client.get("/portfolio/positions", params={"instruments": ["goog"]})

    assert resp.status_code == 200
    assert {r["instrument_id"] for r in resp.json()} == {"goog"}


def test_another_users_positions_are_not_returned(
    transaction_repo: FakeTransactionRepository,
) -> None:
    client = _client_as("user-a", transaction_repo)
    _deposit(client, "acc1", "10000")

    app.dependency_overrides[get_current_user] = lambda: User(id="user-b")

    resp = client.get("/portfolio/positions")

    assert resp.status_code == 200
    assert resp.json() == []


def test_empty_portfolio_returns_an_empty_list(
    transaction_repo: FakeTransactionRepository,
) -> None:
    client = _client_as("user-a", transaction_repo)

    resp = client.get("/portfolio/positions")

    assert resp.status_code == 200
    assert resp.json() == []


def test_requires_auth(transaction_repo: FakeTransactionRepository) -> None:
    client = _client_as("user-a", transaction_repo)
    app.dependency_overrides.pop(get_current_user)
    app.dependency_overrides[get_auth_provider] = lambda: SupabaseAuthProvider(
        project_url="https://test.supabase.co"
    )

    resp = client.get("/portfolio/positions")

    assert resp.status_code == 401
