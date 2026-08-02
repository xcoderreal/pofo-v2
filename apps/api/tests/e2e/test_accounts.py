"""Account end-to-end tests — comprehensive real-HTTP coverage.

Runs against the managed subprocess's default settings (MYAPP_AUTH=stub),
so every request resolves to the fixed dev user automatically.
"""

from __future__ import annotations

import uuid

import httpx
import pytest


def test_create_and_list_account_roundtrip(
    http_client: httpx.Client, allow_writes: bool
) -> None:
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    account_id = f"e2e-acc-{uuid.uuid4().hex[:8]}"
    payload = {
        "id": account_id,
        "name": "E2E Test Brokerage",
        "institution": "E2E Bank",
        "account_type": "brokerage",
    }

    post = http_client.post("/accounts", json=payload)
    assert post.status_code == 201, post.text

    got = http_client.get(f"/accounts/{account_id}")
    assert got.status_code == 200
    assert got.json()["name"] == "E2E Test Brokerage"

    listed = http_client.get("/accounts")
    assert listed.status_code == 200
    assert any(a["id"] == account_id for a in listed.json())


def test_get_nonexistent_account_returns_404(http_client: httpx.Client) -> None:
    resp = http_client.get("/accounts/definitely-not-a-real-account")
    assert resp.status_code == 404


def _fund_and_trade(client: httpx.Client, account_id: str, instrument_id: str) -> None:
    """A deposit and a buy — so the account owns a Deposit, a BUY and the
    BUY's auto-posted CASH leg (docs/adr/0001-dashboard-v2.md § 1)."""
    client.post(
        "/transactions/deposit",
        json={
            "account_id": account_id,
            "amount": "10000",
            "timestamp": "2025-12-31T00:00:00",
        },
    )
    resp = client.post(
        "/transactions",
        json={
            "account_id": account_id,
            "instrument_id": instrument_id,
            "type": "buy",
            "quantity": "10",
            "price": "100",
            "timestamp": "2026-01-02T00:00:00",
        },
    )
    assert resp.status_code == 201, resp.text


def test_delete_account_cascades_over_real_http(
    http_client: httpx.Client, allow_writes: bool
) -> None:
    """The whole cascade end to end: the Account, its Transactions, its
    paired CASH legs and every computed row derived from them."""
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    account_id = f"e2e-del-{uuid.uuid4().hex[:8]}"
    symbol = f"E2E{uuid.uuid4().hex[:6].upper()}"
    instrument_id = f"i-{symbol.lower()}"
    http_client.post(
        "/accounts",
        json={
            "id": account_id,
            "name": "E2E Doomed Brokerage",
            "institution": "E2E Bank",
            "account_type": "brokerage",
        },
    )
    http_client.post(
        "/instruments",
        json={
            "id": instrument_id,
            "symbol": symbol,
            "name": "E2E Test Instrument",
            "asset_class": "equity",
        },
    )
    _fund_and_trade(http_client, account_id, instrument_id)

    ledger = http_client.get("/transactions", params={"accounts": account_id})
    assert ledger.status_code == 200
    # Deposit + BUY + the BUY's paired CASH leg.
    assert len(ledger.json()) == 3
    assert any(row["trade_id"] is not None for row in ledger.json())

    deleted = http_client.delete(f"/accounts/{account_id}")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json() == {"transactions_deleted": 3}

    assert http_client.get(f"/accounts/{account_id}").status_code == 404
    assert (
        http_client.get("/transactions", params={"accounts": account_id}).json() == []
    )
    positions = http_client.get("/portfolio/positions", params={"accounts": account_id})
    assert positions.status_code == 200
    assert positions.json() == []


def test_delete_account_leaves_a_sibling_holding_the_same_instrument_untouched(
    http_client: httpx.Client, allow_writes: bool
) -> None:
    """AC 8 over real HTTP. Both accounts hold the same instrument and both
    booked a realized gain on it; only one is deleted."""
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    symbol = f"E2E{uuid.uuid4().hex[:6].upper()}"
    instrument_id = f"i-{symbol.lower()}"
    http_client.post(
        "/instruments",
        json={
            "id": instrument_id,
            "symbol": symbol,
            "name": "E2E Shared Instrument",
            "asset_class": "equity",
        },
    )

    ids = []
    for label in ("doomed", "survivor"):
        account_id = f"e2e-{label}-{uuid.uuid4().hex[:8]}"
        ids.append(account_id)
        http_client.post(
            "/accounts",
            json={
                "id": account_id,
                "name": f"E2E {label}",
                "institution": "E2E Bank",
                "account_type": "brokerage",
            },
        )
        _fund_and_trade(http_client, account_id, instrument_id)
        sell = http_client.post(
            "/transactions",
            json={
                "account_id": account_id,
                "instrument_id": instrument_id,
                "type": "sell",
                "quantity": "4",
                "price": "150",
                "timestamp": "2026-01-03T00:00:00",
            },
        )
        assert sell.status_code == 201, sell.text

    doomed, survivor = ids
    before = http_client.get("/portfolio/positions", params={"accounts": survivor})
    assert before.status_code == 200
    before_rows = sorted(before.json(), key=lambda r: r["instrument_id"])
    assert any(row["realized_gain"] != "0" for row in before_rows)

    assert http_client.delete(f"/accounts/{doomed}").status_code == 200

    after = http_client.get("/portfolio/positions", params={"accounts": survivor})
    assert sorted(after.json(), key=lambda r: r["instrument_id"]) == before_rows
