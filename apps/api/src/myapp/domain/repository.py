from abc import ABC, abstractmethod

from myapp.domain.model import Category, Item


class ItemRepository(ABC):
    @abstractmethod
    def list_all(self) -> list[Item]: ...

    @abstractmethod
    def get(self, item_id: str) -> Item | None: ...

    @abstractmethod
    def add(self, item: Item) -> None: ...

    @abstractmethod
    def delete(self, item_id: str) -> bool: ...


class CategoryRepository(ABC):
    @abstractmethod
    def list_all(self) -> list[Category]: ...

    @abstractmethod
    def get(self, category_id: str) -> Category | None: ...

    @abstractmethod
    def add(self, category: Category) -> None: ...

    @abstractmethod
    def delete(self, category_id: str) -> bool: ...
