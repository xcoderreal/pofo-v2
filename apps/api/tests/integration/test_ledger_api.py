"""Integration coverage for the Activity feed's endpoint — its response
shaping, its scope params, its ordering and its auth requirement.

The one assertion that carries the ticket: `trade_id` survives
serialization as a real, non-null field on a trade's paired CASH leg. The
suppression rule the client applies is a predicate on exactly that field
(docs/adr/0001-dashboard-v2.md § 2), so a response that dropped it — or
serialized it as an empty string — would silently push the client back to
matching on account/timestamp/amount.
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
TSLA = Instrument(id="tsla", symbol="TSLA", name="Tesla", asset_class=AssetClass.EQUITY)


@pytest.fixture
def transaction_repo() -> FakeTransactionRepository:
    return FakeTransactionRepository()


def _client_as(user_id: str, transaction_repo: FakeTransactionRepository) -> TestClient:
    app.dependency_overrides[get_transaction_repo] = lambda: transaction_repo
    app.dependency_overrides[get_instrument_repo] = lambda: FakeInstrumentRepository(
        [GOOG, TSLA]
    )
    app.dependency_overrides[get_account_repo] = lambda: FakeAccountRepository(
        [BROKERAGE, IRA]
    )
    app.dependency_overrides[get_current_user] = lambda: User(id=user_id)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _deposit(client: TestClient, account_id: str, amount: str, timestamp: str) -> None:
    resp = client.post(
        "/transactions/deposit",
        json={"account_id": account_id, "amount": amount, "timestamp": timestamp},
    )
    assert resp.status_code == 201, resp.text


def _withdraw(client: TestClient, account_id: str, amount: str, timestamp: str) -> None:
    resp = client.post(
        "/transactions/withdraw",
        json={"account_id": account_id, "amount": amount, "timestamp": timestamp},
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


def _by_id(body: list[dict]) -> dict[str, dict]:
    return {row["id"]: row for row in body}


def test_a_trades_cash_leg_serializes_with_the_trades_id(
    transaction_repo: FakeTransactionRepository,
) -> None:
    client = _client_as("user-a", transaction_repo)
    _deposit(client, "acc1", "10000", "2026-01-01T00:00:00")
    _trade(client, "acc1", "goog", "buy", "10", "100", "2026-01-02T00:00:00")

    resp = client.get("/transactions")

    assert resp.status_code == 200, resp.text
    rows = _by_id(resp.json())
    cash_rows = [row for row in rows.values() if row["instrument_id"] == "cash"]
    primary = next(row for row in rows.values() if row["instrument_id"] == "goog")

    # Two CASH rows, and only one of them belongs to a trade: the deposit
    # that funded the account is the genuine one.
    assert sorted(row["trade_id"] is None for row in cash_rows) == [False, True]
    cash_leg = next(row for row in cash_rows if row["trade_id"] is not None)

    # The leg points at the trade it belongs to, by id — the correlation
    # the client's suppression predicate reads, and the reason it never has
    # to guess from amount and timestamp.
    assert cash_leg["trade_id"] == primary["id"]
    assert primary["trade_id"] == primary["id"]
    # A BUY debits cash: a CASH SELL of exactly what was paid.
    assert (cash_leg["type"], cash_leg["quantity"]) == ("sell", "1000")


def test_a_deposit_serializes_with_a_null_trade_id(
    transaction_repo: FakeTransactionRepository,
) -> None:
    """The whole suppression rule turns on this being null rather than
    absent or empty."""
    client = _client_as("user-a", transaction_repo)
    _deposit(client, "acc1", "10000", "2026-01-01T00:00:00")

    row = client.get("/transactions").json()[0]

    assert "trade_id" in row
    assert row["trade_id"] is None


def test_a_sell_carries_its_realized_gain_and_a_buy_carries_null(
    transaction_repo: FakeTransactionRepository,
) -> None:
    client = _client_as("user-a", transaction_repo)
    _deposit(client, "acc1", "10000", "2026-01-01T00:00:00")
    _trade(client, "acc1", "tsla", "buy", "10", "100", "2026-01-02T00:00:00")
    _trade(client, "acc1", "tsla", "sell", "4", "150", "2026-01-03T00:00:00")

    rows = _by_id(client.get("/transactions").json())
    sell = next(
        row
        for row in rows.values()
        if row["instrument_id"] == "tsla" and row["type"] == "sell"
    )
    buy = next(
        row
        for row in rows.values()
        if row["instrument_id"] == "tsla" and row["type"] == "buy"
    )

    assert sell["realized_gain"] == "200"
    assert buy["realized_gain"] is None


def test_entries_are_ordered_newest_first(
    transaction_repo: FakeTransactionRepository,
) -> None:
    client = _client_as("user-a", transaction_repo)
    _deposit(client, "acc1", "1000", "2026-01-01T00:00:00")
    _deposit(client, "acc1", "2000", "2026-03-01T00:00:00")
    _deposit(client, "acc1", "3000", "2026-02-01T00:00:00")

    timestamps = [row["timestamp"] for row in client.get("/transactions").json()]

    assert timestamps == sorted(timestamps, reverse=True)


def test_a_withdrawal_is_a_cash_sell_with_no_trade_id(
    transaction_repo: FakeTransactionRepository,
) -> None:
    client = _client_as("user-a", transaction_repo)
    _deposit(client, "acc1", "1000", "2026-01-01T00:00:00")
    _withdraw(client, "acc1", "400", "2026-01-02T00:00:00")

    row = client.get("/transactions").json()[0]

    assert (row["instrument_id"], row["type"], row["trade_id"]) == (
        "cash",
        "sell",
        None,
    )


def test_accounts_param_scopes_the_feed(
    transaction_repo: FakeTransactionRepository,
) -> None:
    client = _client_as("user-a", transaction_repo)
    _deposit(client, "acc1", "1000", "2026-01-01T00:00:00")
    _deposit(client, "acc2", "2000", "2026-01-02T00:00:00")

    resp = client.get("/transactions", params={"accounts": ["acc2"]})

    assert resp.status_code == 200
    assert {row["account_id"] for row in resp.json()} == {"acc2"}


def test_instruments_param_scopes_the_feed(
    transaction_repo: FakeTransactionRepository,
) -> None:
    client = _client_as("user-a", transaction_repo)
    _deposit(client, "acc1", "10000", "2026-01-01T00:00:00")
    _trade(client, "acc1", "goog", "buy", "10", "100", "2026-01-02T00:00:00")
    _trade(client, "acc1", "tsla", "buy", "5", "200", "2026-01-03T00:00:00")

    resp = client.get("/transactions", params={"instruments": ["goog"]})

    assert resp.status_code == 200
    assert {row["instrument_id"] for row in resp.json()} == {"goog"}


def test_another_users_ledger_is_not_returned(
    transaction_repo: FakeTransactionRepository,
) -> None:
    client = _client_as("user-a", transaction_repo)
    _deposit(client, "acc1", "1000", "2026-01-01T00:00:00")

    app.dependency_overrides[get_current_user] = lambda: User(id="user-b")

    resp = client.get("/transactions")

    assert resp.status_code == 200
    assert resp.json() == []


def test_empty_ledger_returns_an_empty_list(
    transaction_repo: FakeTransactionRepository,
) -> None:
    client = _client_as("user-a", transaction_repo)

    resp = client.get("/transactions")

    assert resp.status_code == 200
    assert resp.json() == []


def test_requires_auth(transaction_repo: FakeTransactionRepository) -> None:
    client = _client_as("user-a", transaction_repo)
    app.dependency_overrides.pop(get_current_user)
    app.dependency_overrides[get_auth_provider] = lambda: SupabaseAuthProvider(
        project_url="https://test.supabase.co"
    )

    resp = client.get("/transactions")

    assert resp.status_code == 401
