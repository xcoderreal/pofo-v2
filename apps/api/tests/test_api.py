"""API integration tests.

Uses FastAPI's dependency_overrides to inject a FakeItemRepository. Each test
gets a fresh repo instance that persists across requests within the test, so
round-trip flows (POST → GET → list) work as they would against a real store.
"""

import pytest
from fastapi.testclient import TestClient

from myapp.domain.model import Item
from myapp.entrypoints.api import app, get_repo
from tests.fake_repository import FakeItemRepository


@pytest.fixture
def repo() -> FakeItemRepository:
    return FakeItemRepository()


@pytest.fixture
def client(repo: FakeItemRepository) -> TestClient:
    # Return the same repo for every request in this test.
    app.dependency_overrides[get_repo] = lambda: repo
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def seeded_client(repo: FakeItemRepository) -> TestClient:
    repo.add_many(
        [
            Item(id="r1", name="Alpha", tags=["a"]),
            Item(id="r2", name="Beta", tags=["b"]),
        ]
    )
    app.dependency_overrides[get_repo] = lambda: repo
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


# ─── Read-only endpoints ───────────────────────────────────────────


def test_list_items_empty(client: TestClient):
    resp = client.get("/items")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_items_seeded(seeded_client: TestClient):
    resp = seeded_client.get("/items")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_get_item(seeded_client: TestClient):
    resp = seeded_client.get("/items/r1")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Alpha"


def test_get_item_not_found(client: TestClient):
    resp = client.get("/items/nonexistent")
    assert resp.status_code == 404


def test_health(client: TestClient):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# ─── Write endpoint ────────────────────────────────────────────────


def test_create_item(client: TestClient):
    payload = {"id": "r3", "name": "Gamma", "tags": ["c"]}
    resp = client.post("/items", json=payload)
    assert resp.status_code == 201
    body = resp.json()
    assert body["id"] == "r3"
    assert body["name"] == "Gamma"
    assert body["tags"] == ["c"]
    assert body["description"] == ""


def test_create_item_minimal_payload(client: TestClient):
    """Only id and name are required; description and tags default."""
    resp = client.post("/items", json={"id": "x", "name": "X"})
    assert resp.status_code == 201
    assert resp.json() == {"id": "x", "name": "X", "description": "", "tags": []}


def test_create_item_missing_required_field(client: TestClient):
    resp = client.post("/items", json={"name": "no-id"})
    assert resp.status_code == 422


def test_create_item_invalid_json(client: TestClient):
    """Reproduces the curl-with-literal-newline failure mode."""
    resp = client.post(
        "/items",
        content=b'{"id":"bad","name":"raw\nnewline"}',
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"][0]["type"] == "json_invalid"


# ─── Round-trip integration flows ──────────────────────────────────


def test_post_then_list_roundtrip(client: TestClient):
    """POST an item, then GET /items should include it."""
    payload = {
        "id": "hello",
        "name": "Hello World",
        "description": "Skeleton frontend works",
        "tags": ["welcome"],
    }
    post_resp = client.post("/items", json=payload)
    assert post_resp.status_code == 201

    list_resp = client.get("/items")
    assert list_resp.status_code == 200
    items = list_resp.json()
    assert len(items) == 1
    assert items[0] == payload


def test_post_then_get_by_id_roundtrip(client: TestClient):
    payload = {"id": "hello", "name": "Hello", "description": "hi", "tags": []}
    client.post("/items", json=payload)

    resp = client.get("/items/hello")
    assert resp.status_code == 200
    assert resp.json() == payload


def test_post_then_filter_by_tag_roundtrip(client: TestClient):
    """POST multiple items, then filter by tag returns only matching ones."""
    client.post("/items", json={"id": "a", "name": "A", "tags": ["welcome"]})
    client.post("/items", json={"id": "b", "name": "B", "tags": ["other"]})
    client.post("/items", json={"id": "c", "name": "C", "tags": ["welcome", "x"]})

    resp = client.get("/items", params={"tag": "welcome"})
    assert resp.status_code == 200
    names = {i["name"] for i in resp.json()}
    assert names == {"A", "C"}


def test_filter_by_nonexistent_tag_returns_empty(client: TestClient):
    client.post("/items", json={"id": "a", "name": "A", "tags": ["welcome"]})
    resp = client.get("/items", params={"tag": "missing"})
    assert resp.status_code == 200
    assert resp.json() == []


def test_multiple_creates_then_list(client: TestClient):
    for i in range(3):
        client.post("/items", json={"id": str(i), "name": f"item-{i}"})
    resp = client.get("/items")
    assert resp.status_code == 200
    assert len(resp.json()) == 3


def test_fixture_isolates_state_between_tests(client: TestClient):
    """Regression guard: each test starts with an empty repo."""
    assert client.get("/items").json() == []
    client.post("/items", json={"id": "leak", "name": "leak"})
    assert len(client.get("/items").json()) == 1
    # Next test should still see an empty repo — enforced by fresh fixture.
