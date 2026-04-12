from myapp.domain.model import Category, Item
from myapp.domain.repository import CategoryRepository, ItemRepository


class FakeItemRepository(ItemRepository):
    def __init__(self, items: list[Item] | None = None):
        self._items: list[Item] = list(items or [])

    def list_all(self) -> list[Item]:
        return list(self._items)

    def get(self, item_id: str) -> Item | None:
        for item in self._items:
            if item.id == item_id:
                return item
        return None

    def add(self, item: Item) -> None:
        self._items.append(item)

    def delete(self, item_id: str) -> bool:
        for i, item in enumerate(self._items):
            if item.id == item_id:
                self._items.pop(i)
                return True
        return False


class FakeCategoryRepository(CategoryRepository):
    def __init__(self, categories: list[Category] | None = None):
        self._categories: list[Category] = list(categories or [])

    def list_all(self) -> list[Category]:
        return list(self._categories)

    def get(self, category_id: str) -> Category | None:
        for cat in self._categories:
            if cat.id == category_id:
                return cat
        return None

    def add(self, category: Category) -> None:
        self._categories.append(category)

    def delete(self, category_id: str) -> bool:
        for i, cat in enumerate(self._categories):
            if cat.id == category_id:
                self._categories.pop(i)
                return True
        return False
