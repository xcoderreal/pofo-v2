"""Portfolio query end-to-end tests — real HTTP against the managed
subprocess's default settings (MYAPP_AUTH=stub).

Deliberately uses only metrics that never touch PriceService
(share_count, cash_balance, realized_gain) — this suite must not depend
on real network access to yfinance. market_price/equity/unrealized_gain
resolution against a real PriceSource is covered by unit tests against
FakePriceSource instead.
"""

from __future__ import annotations

import uuid

import httpx
import pytest


def _seed_account_and_instrument(client: httpx.Client) -> tuple[str, str]:
    account_id = f"e2e-query-acc-{uuid.uuid4().hex[:8]}"
    client.post(
        "/accounts",
        json={
            "id": account_id,
            "name": "E2E Query Brokerage",
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
            "name": "E2E Query Instrument",
            "asset_class": "equity",
        },
    )
    return account_id, instrument_id


def test_share_count_query_reflects_a_logged_buy(
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

    resp = http_client.get(
        "/portfolio/query",
        params={
            "metric": "share_count",
            "instruments": [instrument_id],
            "accounts": [account_id],
            "group_by": "none",
            "start": "2026-01-01",
            "end": "2026-01-05",
            "granularity": "daily",
            "mode": "point_in_time",
        },
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["points"][-1]["value"] == "10"


def test_invalid_metric_mode_pair_returns_400(http_client: httpx.Client) -> None:
    resp = http_client.get(
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


def test_accounts_with_market_price_returns_400(http_client: httpx.Client) -> None:
    resp = http_client.get(
        "/portfolio/query",
        params={
            "metric": "market_price",
            "instruments": ["some-instrument"],
            "accounts": ["some-account"],
            "start": "2026-01-01",
            "end": "2026-01-05",
            "granularity": "daily",
            "mode": "point_in_time",
        },
    )

    assert resp.status_code == 400
