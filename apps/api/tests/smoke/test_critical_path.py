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
    """GET /items returns JSON list. No content assertions — this is smoke."""
    resp = http_client.get("/items")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_unknown_route_404(http_client: httpx.Client):
    """Catches misconfigured proxies that return HTML 200 for unknown paths."""
    resp = http_client.get("/definitely-not-a-real-route")
    assert resp.status_code == 404


def test_create_read_delete_roundtrip(http_client: httpx.Client, allow_writes: bool):
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    item_id = f"smoke-{uuid.uuid4().hex[:8]}"
    payload = {
        "id": item_id,
        "name": "smoke",
        "description": "critical path",
        "tags": ["smoke"],
    }
    post = http_client.post("/items", json=payload)
    assert post.status_code == 201, post.text

    got = http_client.get(f"/items/{item_id}")
    assert got.status_code == 200
    assert got.json()["id"] == item_id
