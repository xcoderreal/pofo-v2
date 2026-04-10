from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from myapp.adapters.memory_repository import MemoryItemRepository
from myapp.domain.repository import ItemRepository
from myapp.service.item_service import ItemService

app = FastAPI(title="My App", description="API backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_repo() -> ItemRepository:
    return MemoryItemRepository()


def get_service(repo: ItemRepository = Depends(get_repo)) -> ItemService:
    return ItemService(repo=repo)


class ItemResponse(BaseModel):
    id: str
    name: str
    description: str = ""
    tags: list[str] = []


class CreateItemRequest(BaseModel):
    id: str
    name: str
    description: str = ""
    tags: list[str] = []


@app.get("/items", response_model=list[ItemResponse])
def list_items(
    tag: str | None = None,
    service: ItemService = Depends(get_service),
):
    items = service.list_items(tag=tag)
    return [
        ItemResponse(id=i.id, name=i.name, description=i.description, tags=i.tags)
        for i in items
    ]


@app.get("/items/{item_id}", response_model=ItemResponse)
def get_item(
    item_id: str,
    service: ItemService = Depends(get_service),
):
    item = service.get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return ItemResponse(id=item.id, name=item.name, description=item.description, tags=item.tags)


@app.post("/items", response_model=ItemResponse, status_code=201)
def create_item(
    request: CreateItemRequest,
    service: ItemService = Depends(get_service),
):
    from myapp.domain.model import Item

    item = Item(id=request.id, name=request.name, description=request.description, tags=request.tags)
    service.create_item(item)
    return ItemResponse(id=item.id, name=item.name, description=item.description, tags=item.tags)


@app.get("/health")
def health():
    return {"status": "ok"}
