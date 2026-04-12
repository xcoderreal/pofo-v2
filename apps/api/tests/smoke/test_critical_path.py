"""Smoke tests — critical path only.

These run over real HTTP against whatever `base_url` resolves to. Intent:
"if these fail, the deploy is severely broken." Keep this file small and
tight so it's safe to run as a 5-minute prod heartbeat.
"""

from __future__ import annotations

import uuid

import httpx
import pytest


def test_health(http_client: httpx.Client):
    resp = http_client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_list_endpoints_reachable(http_client: httpx.Client):
    """All list endpoints return JSON arrays."""
    for path in ["/accounts", "/instruments", "/transactions", "/positions", "/gains"]:
        resp = http_client.get(path)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list), f"{path} did not return a list"


def test_unknown_route_404(http_client: httpx.Client):
    resp = http_client.get("/definitely-not-a-real-route")
    assert resp.status_code == 404


def test_create_read_delete_roundtrip(http_client: httpx.Client, allow_writes: bool):
    if not allow_writes:
        pytest.skip("writes disabled for this target")

    suffix = uuid.uuid4().hex[:8]

    # Create account
    acct = http_client.post(
        "/accounts",
        json={
            "id": f"smoke-{suffix}",
            "name": "Smoke Test",
            "account_type": "brokerage",
        },
    )
    assert acct.status_code == 201

    got = http_client.get(f"/accounts/smoke-{suffix}")
    assert got.status_code == 200
    assert got.json()["id"] == f"smoke-{suffix}"

    # Create instrument
    inst = http_client.post(
        "/instruments",
        json={
            "id": f"inst-{suffix}",
            "ticker": f"SMK{suffix[:3].upper()}",
            "name": "Smoke Stock",
        },
    )
    assert inst.status_code == 201

    # Buy transaction
    txn = http_client.post(
        "/transactions",
        json={
            "id": f"txn-{suffix}",
            "account_id": f"smoke-{suffix}",
            "instrument_id": f"inst-{suffix}",
            "type": "buy",
            "quantity": 10,
            "price": 100.0,
            "date": "2024-01-01",
        },
    )
    assert txn.status_code == 201
