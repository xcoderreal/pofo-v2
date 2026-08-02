from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from myapp.adapters.memory_repository import MemoryInstrumentRepository
from myapp.adapters.stub_auth_provider import StubAuthProvider
from myapp.adapters.supabase_auth_provider import SupabaseAuthProvider
from myapp.config import Settings
from myapp.domain.auth import AuthenticationError, AuthProvider
from myapp.domain.model import AssetClass, Instrument, User
from myapp.domain.repository import InstrumentRepository
from myapp.service.instrument_service import (
    DuplicateIdError,
    DuplicateSymbolError,
    InstrumentService,
)


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
    app.state.instrument_repo = MemoryInstrumentRepository()
    app.state.auth_provider = _build_auth_provider(settings)
    yield


app = FastAPI(title="My App", description="API backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Instrument dependencies ───────────────────────────────────


def get_instrument_repo(request: Request) -> InstrumentRepository:
    return request.app.state.instrument_repo


def get_instrument_service(
    repo: InstrumentRepository = Depends(get_instrument_repo),
) -> InstrumentService:
    return InstrumentService(repo=repo)


# ─── Instrument schemas ────────────────────────────────────────


class InstrumentResponse(BaseModel):
    id: str
    symbol: str
    name: str
    asset_class: AssetClass


class CreateInstrumentRequest(BaseModel):
    id: str
    symbol: str
    name: str
    asset_class: AssetClass


# ─── Converters ─────────────────────────────────────────────────


def _to_instrument_response(instrument: Instrument) -> InstrumentResponse:
    return InstrumentResponse(
        id=instrument.id,
        symbol=instrument.symbol,
        name=instrument.name,
        asset_class=instrument.asset_class,
    )


# ─── Instrument routes ─────────────────────────────────────────
# Instruments are global reference data (a ticker symbol isn't private) —
# see docs/domain-model.md. No user scoping, no auth dependency here.


@app.get("/instruments", response_model=list[InstrumentResponse])
def list_instruments(
    service: InstrumentService = Depends(get_instrument_service),
):
    return [_to_instrument_response(i) for i in service.list_instruments()]


@app.get("/instruments/{instrument_id}", response_model=InstrumentResponse)
def get_instrument(
    instrument_id: str,
    service: InstrumentService = Depends(get_instrument_service),
):
    instrument = service.get_instrument(instrument_id)
    if not instrument:
        raise HTTPException(status_code=404, detail="Instrument not found")
    return _to_instrument_response(instrument)


@app.post("/instruments", response_model=InstrumentResponse, status_code=201)
def create_instrument(
    request: CreateInstrumentRequest,
    service: InstrumentService = Depends(get_instrument_service),
):
    instrument = Instrument(
        id=request.id,
        symbol=request.symbol,
        name=request.name,
        asset_class=request.asset_class,
    )
    try:
        service.create_instrument(instrument)
    except (DuplicateIdError, DuplicateSymbolError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _to_instrument_response(instrument)


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
