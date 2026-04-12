from dataclasses import dataclass

from myapp.domain.model import Category
from myapp.domain.repository import CategoryRepository


@dataclass
class CategoryService:
    repo: CategoryRepository

    def list_categories(self) -> list[Category]:
        return self.repo.list_all()

    def get_category(self, category_id: str) -> Category | None:
        return self.repo.get(category_id)

    def create_category(self, category: Category) -> Category:
        self.repo.add(category)
        return category

    def delete_category(self, category_id: str) -> bool:
        return self.repo.delete(category_id)
