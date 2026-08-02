"""Instrument end-to-end tests — comprehensive real-HTTP coverage.

Runs over whatever `base_url` resolves to (managed subprocess by default,
or `SKELETON_E2E_URL` for BYO / staging / prod).
"""

from __future__ import annotations

import uuid

import httpx
import pytest


def _unique_symbol() -> str:
    return f"E2E{uuid.uuid4().hex[:6].upper()}"


def test_create_and_get_instrument_roundtrip(
    http_client: httpx.Client, allow_writes: bool
) -> None:
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    symbol = _unique_symbol()
    instrument_id = f"i-{symbol.lower()}"
    payload = {
        "id": instrument_id,
        "symbol": symbol,
        "name": "E2E Test Instrument",
        "asset_class": "equity",
    }

    post = http_client.post("/instruments", json=payload)
    assert post.status_code == 201, post.text

    got = http_client.get(f"/instruments/{instrument_id}")
    assert got.status_code == 200
    assert got.json()["symbol"] == symbol

    listed = http_client.get("/instruments")
    assert listed.status_code == 200
    assert any(i["id"] == instrument_id for i in listed.json())


def test_duplicate_symbol_returns_409(
    http_client: httpx.Client, allow_writes: bool
) -> None:
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    symbol = _unique_symbol()
    payload = {
        "id": f"i-{symbol.lower()}-1",
        "symbol": symbol,
        "name": "First",
        "asset_class": "equity",
    }
    http_client.post("/instruments", json=payload)

    dup_payload = {**payload, "id": f"i-{symbol.lower()}-2", "name": "Duplicate"}
    resp = http_client.post("/instruments", json=dup_payload)
    assert resp.status_code == 409
