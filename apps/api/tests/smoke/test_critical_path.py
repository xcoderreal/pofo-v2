"""Smoke tests — critical path only.

These run over real HTTP against whatever `base_url` resolves to. Intent:
"if these fail, the deploy is severely broken." Keep this file small and
tight so it's safe to run as a 5-minute prod heartbeat.

Write tests are gated by `allow_writes` so a misconfigured cron can't
POST into prod.
"""

from __future__ import annotations

import uuid

import httpx
import pytest


def test_health(http_client: httpx.Client):
    resp = http_client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_list_endpoint_reachable(http_client: httpx.Client):
    """GET /instruments returns JSON list. No content assertions — this is smoke."""
    resp = http_client.get("/instruments")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_unknown_route_404(http_client: httpx.Client):
    """Catches misconfigured proxies that return HTML 200 for unknown paths."""
    resp = http_client.get("/definitely-not-a-real-route")
    assert resp.status_code == 404


def test_me_reachable(http_client: httpx.Client):
    """A broken auth path locks everyone out — smoke it directly."""
    resp = http_client.get("/me")
    assert resp.status_code == 200
    assert "user_id" in resp.json()


def test_create_read_roundtrip(http_client: httpx.Client, allow_writes: bool):
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    symbol = f"SMK{uuid.uuid4().hex[:6].upper()}"
    instrument_id = f"smoke-{symbol.lower()}"
    payload = {
        "id": instrument_id,
        "symbol": symbol,
        "name": "smoke",
        "asset_class": "equity",
    }
    post = http_client.post("/instruments", json=payload)
    assert post.status_code == 201, post.text

    got = http_client.get(f"/instruments/{instrument_id}")
    assert got.status_code == 200
    assert got.json()["id"] == instrument_id
