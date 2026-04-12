import pytest

from myapp.domain.model import Category
from myapp.service.category_service import CategoryService
from tests.fake_repository import FakeCategoryRepository


@pytest.fixture
def repo():
    return FakeCategoryRepository(
        [
            Category(id="1", name="Electronics"),
            Category(id="2", name="Books"),
        ]
    )


@pytest.fixture
def service(repo):
    return CategoryService(repo=repo)


def test_list_categories(service):
    assert len(service.list_categories()) == 2


def test_get_category(service):
    cat = service.get_category("1")
    assert cat is not None
    assert cat.name == "Electronics"


def test_get_category_not_found(service):
    assert service.get_category("nonexistent") is None


def test_create_category(service):
    new_cat = Category(id="3", name="Clothing")
    service.create_category(new_cat)
    assert len(service.list_categories()) == 3
    assert service.get_category("3").name == "Clothing"


def test_delete_category(service):
    assert service.delete_category("1") is True
    assert len(service.list_categories()) == 1
    assert service.get_category("1") is None


def test_delete_category_not_found(service):
    assert service.delete_category("nonexistent") is False
