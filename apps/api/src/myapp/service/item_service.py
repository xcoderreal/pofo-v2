from dataclasses import dataclass

from myapp.domain.model import Item
from myapp.domain.repository import ItemRepository


@dataclass
class ItemService:
    repo: ItemRepository

    def list_items(self, tag: str | None = None) -> list[Item]:
        items = self.repo.list_all()
        if tag:
            items = [i for i in items if tag in i.tags]
        return items

    def get_item(self, item_id: str) -> Item | None:
        return self.repo.get(item_id)

    def create_item(self, item: Item) -> Item:
        self.repo.add(item)
        return item

    def delete_item(self, item_id: str) -> bool:
        return self.repo.delete(item_id)
