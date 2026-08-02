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
