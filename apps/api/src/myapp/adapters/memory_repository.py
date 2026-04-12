from myapp.domain.model import Item
from myapp.domain.repository import ItemRepository


class MemoryItemRepository(ItemRepository):
    """In-memory repository.

    Useful for development and as a reference implementation.
    """

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
