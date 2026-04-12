from dataclasses import dataclass, field


@dataclass
class Category:
    id: str
    name: str


@dataclass
class Item:
    id: str
    name: str
    description: str = ""
    tags: list[str] = field(default_factory=list)
    category_id: str | None = None
