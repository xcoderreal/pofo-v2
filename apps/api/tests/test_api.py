from fastapi.testclient import TestClient

from myapp.domain.model import Item
from myapp.domain.repository import ItemRepository
from myapp.entrypoints.api import app, get_repo
from tests.fake_repository import FakeItemRepository

_ITEMS = [
    Item(id="r1", name="Alpha", tags=["a"]),
    Item(id="r2", name="Beta", tags=["b"]),
]


def _fake_repo() -> ItemRepository:
    return FakeItemRepository(_ITEMS)


app.dependency_overrides[get_repo] = _fake_repo
client = TestClient(app)


def test_list_items():
    resp = client.get("/items")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_get_item():
    resp = client.get("/items/r1")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Alpha"


def test_get_item_not_found():
    resp = client.get("/items/nonexistent")
    assert resp.status_code == 404


def test_create_item():
    resp = client.post("/items", json={"id": "r3", "name": "Gamma", "tags": ["c"]})
    assert resp.status_code == 201
    assert resp.json()["name"] == "Gamma"


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
