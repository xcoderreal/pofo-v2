from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from myapp.adapters.memory_repository import MemoryItemRepository
from myapp.domain.model import Item
from myapp.domain.repository import ItemRepository
from myapp.service.item_service import ItemService


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create long-lived resources at startup; clean up on shutdown.
    # Swap the adapter here when adding persistence (SQLite, Postgres, etc.).
    app.state.repo = MemoryItemRepository()
    yield


app = FastAPI(title="My App", description="API backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_repo(request: Request) -> ItemRepository:
    return request.app.state.repo


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


def _to_response(item: Item) -> ItemResponse:
    return ItemResponse(
        id=item.id,
        name=item.name,
        description=item.description,
        tags=item.tags,
    )


@app.get("/items", response_model=list[ItemResponse])
def list_items(
    tag: str | None = None,
    service: ItemService = Depends(get_service),
):
    return [_to_response(i) for i in service.list_items(tag=tag)]


@app.get("/items/{item_id}", response_model=ItemResponse)
def get_item(
    item_id: str,
    service: ItemService = Depends(get_service),
):
    item = service.get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return _to_response(item)


@app.post("/items", response_model=ItemResponse, status_code=201)
def create_item(
    request: CreateItemRequest,
    service: ItemService = Depends(get_service),
):
    item = Item(
        id=request.id,
        name=request.name,
        description=request.description,
        tags=request.tags,
    )
    service.create_item(item)
    return _to_response(item)


@app.get("/health")
def health():
    return {"status": "ok"}
