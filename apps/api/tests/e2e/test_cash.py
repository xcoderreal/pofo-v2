"""Deposit/Withdrawal end-to-end tests — real HTTP against the managed
subprocess's default settings (MYAPP_AUTH=stub).
"""

from __future__ import annotations

import uuid

import httpx
import pytest

from myapp.service.cash_service import CASH_INSTRUMENT_ID


def _seed_account(client: httpx.Client) -> str:
    account_id = f"e2e-cash-acc-{uuid.uuid4().hex[:8]}"
    client.post(
        "/accounts",
        json={
            "id": account_id,
            "name": "E2E Cash Brokerage",
            "institution": "E2E Bank",
            "account_type": "brokerage",
        },
    )
    return account_id


def test_deposit_then_withdraw_roundtrip(
    http_client: httpx.Client, allow_writes: bool
) -> None:
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    account_id = _seed_account(http_client)

    deposit = http_client.post(
        "/transactions/deposit",
        json={
            "account_id": account_id,
            "amount": "500",
            "timestamp": "2026-01-01T00:00:00",
        },
    )
    assert deposit.status_code == 201, deposit.text

    withdraw = http_client.post(
        "/transactions/withdraw",
        json={
            "account_id": account_id,
            "amount": "150",
            "timestamp": "2026-01-02T00:00:00",
        },
    )
    assert withdraw.status_code == 201, withdraw.text

    position = http_client.get(
        f"/accounts/{account_id}/instruments/{CASH_INSTRUMENT_ID}/position"
    )
    assert position.status_code == 200
    assert position.json()["share_count"] == "350"
