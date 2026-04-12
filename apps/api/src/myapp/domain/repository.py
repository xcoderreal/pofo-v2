from abc import ABC, abstractmethod

from myapp.domain.model import Item


class ItemRepository(ABC):
    @abstractmethod
    def list_all(self) -> list[Item]: ...

    @abstractmethod
    def get(self, item_id: str) -> Item | None: ...

    @abstractmethod
    def add(self, item: Item) -> None: ...
