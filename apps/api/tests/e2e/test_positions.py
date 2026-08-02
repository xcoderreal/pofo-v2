"""Batched positions end-to-end — real HTTP against the managed
subprocess's default settings (MYAPP_AUTH=stub).

Deliberately network-free, like tests/e2e/test_query.py. Two shapes reach
every field without a price fetch: a CASH row (priced at a definitional 1,
never fetched) and a *fully closed* equity row (zero shares means market
value is zero by definition, so PositionsService skips the price lookup
entirely). Open non-cash positions' market_value depends on a real
PriceSource and is pinned by the integration tier against FakePriceSource
instead.
"""

from __future__ import annotations

import uuid

import httpx
import pytest


def _seed_account_and_instrument(client: httpx.Client) -> tuple[str, str]:
    account_id = f"e2e-pos-acc-{uuid.uuid4().hex[:8]}"
    client.post(
        "/accounts",
        json={
            "id": account_id,
            "name": "E2E Positions Brokerage",
            "institution": "E2E Bank",
            "account_type": "brokerage",
        },
    )
    symbol = f"E2E{uuid.uuid4().hex[:6].upper()}"
    instrument_id = f"i-{symbol.lower()}"
    client.post(
        "/instruments",
        json={
            "id": instrument_id,
            "symbol": symbol,
            "name": "E2E Positions Instrument",
            "asset_class": "equity",
        },
    )
    return account_id, instrument_id


def _by_instrument(body: list[dict]) -> dict[str, dict]:
    return {row["instrument_id"]: row for row in body}


def test_batched_positions_round_trip(
    http_client: httpx.Client, allow_writes: bool
) -> None:
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    account_id, instrument_id = _seed_account_and_instrument(http_client)
    http_client.post(
        "/transactions/deposit",
        json={
            "account_id": account_id,
            "amount": "10000",
            "timestamp": "2025-12-31T00:00:00",
        },
    )
    http_client.post(
        "/transactions",
        json={
            "account_id": account_id,
            "instrument_id": instrument_id,
            "type": "buy",
            "quantity": "10",
            "price": "100",
            "timestamp": "2026-01-01T00:00:00",
        },
    )
    http_client.post(
        "/transactions",
        json={
            "account_id": account_id,
            "instrument_id": instrument_id,
            "type": "sell",
            "quantity": "10",
            "price": "150",
            "timestamp": "2026-01-02T00:00:00",
        },
    )

    resp = http_client.get("/portfolio/positions", params={"accounts": [account_id]})

    assert resp.status_code == 200, resp.text
    rows = _by_instrument(resp.json())

    # One call, both legs of the ledger: the closed equity position and
    # the CASH position the trade's paired legs moved.
    assert set(rows) == {instrument_id, "cash"}

    closed = rows[instrument_id]
    assert closed["share_count"] == "0"
    assert closed["cost_basis"] == "0"
    assert closed["average_cost"] is None
    assert closed["market_value"] == "0"
    assert closed["realized_gain"] == "500"  # (150 - 100) * 10
    assert closed["unrealized_gain"] == "0"

    cash = rows["cash"]
    # 10000 deposited - 1000 spent + 1500 proceeds.
    assert cash["share_count"] == "10500"
    assert cash["market_value"] == "10500"
    assert cash["average_cost"] == "1"


def test_instruments_param_scopes_the_result(
    http_client: httpx.Client, allow_writes: bool
) -> None:
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    account_id, _ = _seed_account_and_instrument(http_client)
    http_client.post(
        "/transactions/deposit",
        json={
            "account_id": account_id,
            "amount": "500",
            "timestamp": "2025-12-31T00:00:00",
        },
    )

    resp = http_client.get(
        "/portfolio/positions",
        params={"accounts": [account_id], "instruments": ["cash"]},
    )

    assert resp.status_code == 200, resp.text
    assert [row["instrument_id"] for row in resp.json()] == ["cash"]


def test_an_account_with_no_history_yields_no_rows(
    http_client: httpx.Client, allow_writes: bool
) -> None:
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    account_id, _ = _seed_account_and_instrument(http_client)

    resp = http_client.get("/portfolio/positions", params={"accounts": [account_id]})

    assert resp.status_code == 200, resp.text
    assert resp.json() == []
