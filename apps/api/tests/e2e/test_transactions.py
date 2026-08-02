"""Transaction/Position end-to-end tests — real HTTP against the managed
subprocess's default settings (MYAPP_AUTH=stub), so every request
resolves to the fixed dev user automatically.
"""

from __future__ import annotations

import uuid

import httpx
import pytest


def _seed_account_and_instrument(client: httpx.Client) -> tuple[str, str]:
    account_id = f"e2e-acc-{uuid.uuid4().hex[:8]}"
    client.post(
        "/accounts",
        json={
            "id": account_id,
            "name": "E2E Brokerage",
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
            "name": "E2E Test Instrument",
            "asset_class": "equity",
        },
    )
    return account_id, instrument_id


def _deposit(client: httpx.Client, account_id: str, amount: str) -> None:
    client.post(
        "/transactions/deposit",
        json={
            "account_id": account_id,
            "amount": amount,
            "timestamp": "2025-12-31T00:00:00",
        },
    )


def test_log_buy_then_position_reflects_it(
    http_client: httpx.Client, allow_writes: bool
) -> None:
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    account_id, instrument_id = _seed_account_and_instrument(http_client)
    _deposit(http_client, account_id, "10000")  # funds the buy below

    post = http_client.post(
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
    assert post.status_code == 201, post.text

    position = http_client.get(
        f"/accounts/{account_id}/instruments/{instrument_id}/position"
    )
    assert position.status_code == 200
    assert position.json()["share_count"] == "10"


def test_selling_more_than_held_returns_409(
    http_client: httpx.Client, allow_writes: bool
) -> None:
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    account_id, instrument_id = _seed_account_and_instrument(http_client)

    resp = http_client.post(
        "/transactions",
        json={
            "account_id": account_id,
            "instrument_id": instrument_id,
            "type": "sell",
            "quantity": "5",
            "price": "200",
            "timestamp": "2026-01-01T00:00:00",
        },
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "insufficient_shares"


def test_buying_beyond_available_cash_returns_409_naming_cash(
    http_client: httpx.Client, allow_writes: bool
) -> None:
    """Over real HTTP, because the entry sheet's insufficient-cash message
    is composed from this exact body (#22) and a shape that only survives
    the ASGI in-process client is not the shape a browser sees."""
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    account_id, instrument_id = _seed_account_and_instrument(http_client)
    _deposit(http_client, account_id, "100")  # the buy below costs 2,000

    resp = http_client.post(
        "/transactions",
        json={
            "account_id": account_id,
            "instrument_id": instrument_id,
            "type": "buy",
            "quantity": "10",
            "price": "200",
            "timestamp": "2026-01-01T00:00:00",
        },
    )

    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["code"] == "insufficient_cash"
    assert detail["account_id"] == account_id
    assert detail["instrument_id"] == "cash"
    assert detail["requested"] == "2000"
    assert detail["available"] == "100"
