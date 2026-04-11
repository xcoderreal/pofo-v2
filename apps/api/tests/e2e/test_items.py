"""End-to-end tests — comprehensive real-HTTP coverage.

Runs over whatever `base_url` resolves to (managed subprocess by default,
or `SKELETON_E2E_URL` for BYO / staging / prod). Intent: "is any feature
broken, not just the critical path."

Writes are gated by `allow_writes`. When running locally, every POSTed
item is tracked and deleted in teardown — but note: the skeleton has no
DELETE endpoint yet, so cleanup is a no-op for now. See the `created_ids`
fixture below.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import httpx
import pytest


@pytest.fixture
def created_ids(http_client: httpx.Client) -> Iterator[list[str]]:
    """Track IDs created during a test. Cleanup is best-effort."""
    ids: list[str] = []
    yield ids
    # No DELETE endpoint yet — placeholder for when one exists.
    # for item_id in ids:
    #     http_client.delete(f"/items/{item_id}")


def _new_id(prefix: str = "e2e") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


# ─── Read-only (safe against any target) ────────────────────────────


def test_health_shape(http_client: httpx.Client):
    resp = http_client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_list_items_returns_list(http_client: httpx.Client):
    resp = http_client.get("/items")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_get_item_not_found(http_client: httpx.Client):
    resp = http_client.get(f"/items/{_new_id('missing')}")
    assert resp.status_code == 404


def test_list_items_with_nonexistent_tag(http_client: httpx.Client):
    resp = http_client.get("/items", params={"tag": f"nope-{uuid.uuid4().hex[:6]}"})
    assert resp.status_code == 200
    assert resp.json() == []


# ─── Write endpoints (gated) ─────────────────────────────────────────


def test_create_item_full_payload(
    http_client: httpx.Client, allow_writes: bool, created_ids: list[str]
):
    if not allow_writes:
        pytest.skip("writes disabled")

    item_id = _new_id()
    created_ids.append(item_id)
    payload = {
        "id": item_id,
        "name": "Full",
        "description": "has description",
        "tags": ["e2e", "full"],
    }
    resp = http_client.post("/items", json=payload)
    assert resp.status_code == 201
    body = resp.json()
    assert body == payload


def test_create_item_minimal_payload(
    http_client: httpx.Client, allow_writes: bool, created_ids: list[str]
):
    if not allow_writes:
        pytest.skip("writes disabled")

    item_id = _new_id("min")
    created_ids.append(item_id)
    resp = http_client.post("/items", json={"id": item_id, "name": "Min"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["id"] == item_id
    assert body["name"] == "Min"
    assert body["description"] == ""
    assert body["tags"] == []


def test_create_then_get_roundtrip(
    http_client: httpx.Client, allow_writes: bool, created_ids: list[str]
):
    if not allow_writes:
        pytest.skip("writes disabled")

    item_id = _new_id("rt")
    created_ids.append(item_id)
    payload = {
        "id": item_id,
        "name": "Roundtrip",
        "description": "",
        "tags": ["e2e"],
    }
    http_client.post("/items", json=payload)

    resp = http_client.get(f"/items/{item_id}")
    assert resp.status_code == 200
    assert resp.json() == payload


def test_create_then_filter_by_tag(
    http_client: httpx.Client, allow_writes: bool, created_ids: list[str]
):
    if not allow_writes:
        pytest.skip("writes disabled")

    unique_tag = f"tag-{uuid.uuid4().hex[:8]}"
    item_id = _new_id("filter")
    created_ids.append(item_id)
    http_client.post(
        "/items",
        json={"id": item_id, "name": "Tagged", "tags": [unique_tag]},
    )

    resp = http_client.get("/items", params={"tag": unique_tag})
    assert resp.status_code == 200
    ids = {i["id"] for i in resp.json()}
    assert item_id in ids


# ─── Error paths ─────────────────────────────────────────────────────


def test_create_item_missing_required_field(
    http_client: httpx.Client, allow_writes: bool
):
    if not allow_writes:
        pytest.skip("writes disabled")
    resp = http_client.post("/items", json={"name": "no-id"})
    assert resp.status_code == 422


def test_create_item_invalid_json(http_client: httpx.Client, allow_writes: bool):
    if not allow_writes:
        pytest.skip("writes disabled")
    resp = http_client.post(
        "/items",
        content=b'{"id":"bad","name":"raw\nnewline"}',
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 422


def test_create_item_wrong_types(http_client: httpx.Client, allow_writes: bool):
    if not allow_writes:
        pytest.skip("writes disabled")
    resp = http_client.post(
        "/items",
        json={"id": 123, "name": "bad", "tags": "not-a-list"},
    )
    assert resp.status_code == 422


def test_unknown_route_returns_json_404(http_client: httpx.Client):
    resp = http_client.get("/nope")
    assert resp.status_code == 404
    # Proxy sanity: should be JSON, not HTML.
    ctype = resp.headers.get("content-type", "")
    assert "application/json" in ctype
