import pytest

from myapp.domain.model import Item
from myapp.service.item_service import ItemService
from tests.fake_repository import FakeItemRepository


@pytest.fixture
def repo():
    return FakeItemRepository(
        [
            Item(id="1", name="Alpha", tags=["a", "b"]),
            Item(id="2", name="Beta", tags=["b", "c"]),
            Item(id="3", name="Gamma", tags=["a"]),
        ]
    )


@pytest.fixture
def service(repo):
    return ItemService(repo=repo)


def test_list_all(service):
    assert len(service.list_items()) == 3


def test_list_by_tag(service):
    results = service.list_items(tag="a")
    assert len(results) == 2
    assert all("a" in i.tags for i in results)


def test_get_item(service):
    item = service.get_item("1")
    assert item is not None
    assert item.name == "Alpha"


def test_get_item_not_found(service):
    assert service.get_item("nonexistent") is None


def test_create_item(service):
    new_item = Item(id="4", name="Delta")
    service.create_item(new_item)
    assert len(service.list_items()) == 4
    assert service.get_item("4").name == "Delta"


def test_create_item_with_category(service):
    new_item = Item(id="5", name="Epsilon", category_id="cat-1")
    service.create_item(new_item)
    created = service.get_item("5")
    assert created.category_id == "cat-1"


def test_delete_item(service):
    assert service.delete_item("1") is True
    assert len(service.list_items()) == 2
    assert service.get_item("1") is None


def test_delete_item_not_found(service):
    assert service.delete_item("nonexistent") is False
