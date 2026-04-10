from dataclasses import dataclass, field


@dataclass
class Item:
    id: str
    name: str
    description: str = ""
    tags: list[str] = field(default_factory=list)
