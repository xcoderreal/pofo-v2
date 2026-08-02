from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from myapp.adapters.memory_repository import (
    MemoryCategoryRepository,
    MemoryItemRepository,
)
from myapp.adapters.stub_auth_provider import StubAuthProvider
from myapp.adapters.supabase_auth_provider import SupabaseAuthProvider
from myapp.config import Settings
from myapp.domain.auth import AuthenticationError, AuthProvider
from myapp.domain.model import Category, Item, User
from myapp.domain.repository import CategoryRepository, ItemRepository
from myapp.service.category_service import CategoryService
from myapp.service.item_service import ItemService


def _build_auth_provider(settings: Settings) -> AuthProvider:
    if settings.auth == "supabase":
        if not settings.supabase_jwt_secret:
            raise RuntimeError(
                "MYAPP_SUPABASE_JWT_SECRET is required when MYAPP_AUTH=supabase"
            )
        return SupabaseAuthProvider(jwt_secret=settings.supabase_jwt_secret)
    return StubAuthProvider()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create long-lived resources at startup; clean up on shutdown.
    # Swap the adapter here when adding persistence (SQLite, Postgres, etc.).
    # Settings() is constructed here, not at module import time, so the
    # production/stub validation guard fires at real app startup rather
    # than whenever this module happens to be imported (e.g. test collection).
    settings = Settings()
    app.state.item_repo = MemoryItemRepository()
    app.state.category_repo = MemoryCategoryRepository()
    app.state.auth_provider = _build_auth_provider(settings)
    yield


app = FastAPI(title="My App", description="API backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Item dependencies ────────────────────────────────────────


def get_repo(request: Request) -> ItemRepository:
    return request.app.state.item_repo


def get_service(repo: ItemRepository = Depends(get_repo)) -> ItemService:
    return ItemService(repo=repo)


# ─── Category dependencies ────────────────────────────────────


def get_category_repo(request: Request) -> CategoryRepository:
    return request.app.state.category_repo


def get_category_service(
    repo: CategoryRepository = Depends(get_category_repo),
) -> CategoryService:
    return CategoryService(repo=repo)


# ─── Item schemas ─────────────────────────────────────────────


class ItemResponse(BaseModel):
    id: str
    name: str
    description: str = ""
    tags: list[str] = []
    category_id: str | None = None


class CreateItemRequest(BaseModel):
    id: str
    name: str
    description: str = ""
    tags: list[str] = []
    category_id: str | None = None


# ─── Category schemas ─────────────────────────────────────────


class CategoryResponse(BaseModel):
    id: str
    name: str


class CreateCategoryRequest(BaseModel):
    id: str
    name: str


# ─── Converters ───────────────────────────────────────────────


def _to_item_response(item: Item) -> ItemResponse:
    return ItemResponse(
        id=item.id,
        name=item.name,
        description=item.description,
        tags=item.tags,
        category_id=item.category_id,
    )


def _to_category_response(category: Category) -> CategoryResponse:
    return CategoryResponse(id=category.id, name=category.name)


# ─── Item routes ──────────────────────────────────────────────


@app.get("/items", response_model=list[ItemResponse])
def list_items(
    tag: str | None = None,
    category_id: str | None = None,
    service: ItemService = Depends(get_service),
):
    items = service.list_items(tag=tag)
    if category_id is not None:
        items = [i for i in items if i.category_id == category_id]
    return [_to_item_response(i) for i in items]


@app.get("/items/{item_id}", response_model=ItemResponse)
def get_item(
    item_id: str,
    service: ItemService = Depends(get_service),
):
    item = service.get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return _to_item_response(item)


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
        category_id=request.category_id,
    )
    service.create_item(item)
    return _to_item_response(item)


@app.delete("/items/{item_id}", status_code=204)
def delete_item(
    item_id: str,
    service: ItemService = Depends(get_service),
):
    item = service.get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    service.delete_item(item_id)


# ─── Category routes ──────────────────────────────────────────


@app.get("/categories", response_model=list[CategoryResponse])
def list_categories(
    service: CategoryService = Depends(get_category_service),
):
    return [_to_category_response(c) for c in service.list_categories()]


@app.get("/categories/{category_id}", response_model=CategoryResponse)
def get_category(
    category_id: str,
    service: CategoryService = Depends(get_category_service),
):
    category = service.get_category(category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    return _to_category_response(category)


@app.post("/categories", response_model=CategoryResponse, status_code=201)
def create_category(
    request: CreateCategoryRequest,
    service: CategoryService = Depends(get_category_service),
):
    category = Category(id=request.id, name=request.name)
    service.create_category(category)
    return _to_category_response(category)


@app.delete("/categories/{category_id}", status_code=204)
def delete_category(
    category_id: str,
    service: CategoryService = Depends(get_category_service),
):
    deleted = service.delete_category(category_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Category not found")


# ─── Auth ─────────────────────────────────────────────────────


def get_auth_provider(request: Request) -> AuthProvider:
    return request.app.state.auth_provider


def get_current_user(
    request: Request,
    auth_provider: AuthProvider = Depends(get_auth_provider),
) -> User:
    auth_header = request.headers.get("authorization", "")
    token = auth_header.removeprefix("Bearer ").strip() if auth_header else None
    try:
        return auth_provider.get_user(token)
    except AuthenticationError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@app.get("/me")
def get_me(current_user: User = Depends(get_current_user)) -> dict[str, str]:
    return {"user_id": current_user.id}


# ─── Health ───────────────────────────────────────────────────


@app.get("/health")
def health():
    return {"status": "ok"}
