import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime
from decimal import Decimal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from myapp.adapters.memory_repository import (
    MemoryAccountRepository,
    MemoryInstrumentRepository,
    MemoryPriceHistoryRepository,
    MemoryTransactionRepository,
)
from myapp.adapters.stub_auth_provider import StubAuthProvider
from myapp.adapters.supabase_auth_provider import SupabaseAuthProvider
from myapp.adapters.yfinance_price_source import YFinancePriceSource
from myapp.config import Settings
from myapp.domain.auth import AuthenticationError, AuthProvider
from myapp.domain.model import (
    Account,
    AccountType,
    AssetClass,
    Instrument,
    Transaction,
    TransactionType,
    User,
)
from myapp.domain.position import InsufficientSharesError
from myapp.domain.price import PriceSource
from myapp.domain.query import Granularity, GroupBy, Metric, Mode
from myapp.domain.repository import (
    AccountRepository,
    InstrumentRepository,
    PriceHistoryRepository,
    TransactionRepository,
)
from myapp.service.account_service import AccountService
from myapp.service.account_service import DuplicateIdError as AccountDuplicateIdError
from myapp.service.cash_service import CashService
from myapp.service.instrument_service import (
    DuplicateIdError as InstrumentDuplicateIdError,
)
from myapp.service.instrument_service import DuplicateSymbolError, InstrumentService
from myapp.service.price_service import PriceService
from myapp.service.query_service import (
    AccountsNotApplicableError,
    InstrumentsNotApplicableError,
    InvalidMetricModeError,
    QueryService,
)
from myapp.service.transaction_service import (
    AccountNotFoundError,
    InstrumentNotFoundError,
    TransactionService,
)


def _build_auth_provider(settings: Settings) -> AuthProvider:
    if settings.auth == "supabase":
        if not settings.supabase_url:
            raise RuntimeError(
                "MYAPP_SUPABASE_URL is required when MYAPP_AUTH=supabase"
            )
        return SupabaseAuthProvider(project_url=settings.supabase_url)
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
    app.state.account_repo = MemoryAccountRepository()
    app.state.transaction_repo = MemoryTransactionRepository()
    app.state.price_history_repo = MemoryPriceHistoryRepository()
    app.state.price_source = YFinancePriceSource()
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
    except (InstrumentDuplicateIdError, DuplicateSymbolError) as exc:
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


# ─── Account dependencies ──────────────────────────────────────


def get_account_repo(request: Request) -> AccountRepository:
    return request.app.state.account_repo


def get_account_service(
    repo: AccountRepository = Depends(get_account_repo),
) -> AccountService:
    return AccountService(repo=repo)


# ─── Account schemas ────────────────────────────────────────────


class AccountResponse(BaseModel):
    id: str
    name: str
    institution: str
    account_type: AccountType


class CreateAccountRequest(BaseModel):
    id: str
    name: str
    institution: str
    account_type: AccountType


def _to_account_response(account: Account) -> AccountResponse:
    return AccountResponse(
        id=account.id,
        name=account.name,
        institution=account.institution,
        account_type=account.account_type,
    )


# ─── Account routes ─────────────────────────────────────────────
# Accounts are user-owned — every route requires auth and every read/write
# is scoped to current_user.id. Cross-user reads return 404, not 403
# (docs/auth.md's 401/404 policy) — the service layer enforces this the
# same way a real Supabase RLS policy would at the query layer.


@app.get("/accounts", response_model=list[AccountResponse])
def list_accounts(
    current_user: User = Depends(get_current_user),
    service: AccountService = Depends(get_account_service),
):
    accounts = service.list_accounts(user_id=current_user.id)
    return [_to_account_response(a) for a in accounts]


@app.get("/accounts/{account_id}", response_model=AccountResponse)
def get_account(
    account_id: str,
    current_user: User = Depends(get_current_user),
    service: AccountService = Depends(get_account_service),
):
    account = service.get_account(account_id, user_id=current_user.id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return _to_account_response(account)


@app.post("/accounts", response_model=AccountResponse, status_code=201)
def create_account(
    request: CreateAccountRequest,
    current_user: User = Depends(get_current_user),
    service: AccountService = Depends(get_account_service),
):
    account = Account(
        id=request.id,
        user_id=current_user.id,
        name=request.name,
        institution=request.institution,
        account_type=request.account_type,
    )
    try:
        service.create_account(account)
    except AccountDuplicateIdError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _to_account_response(account)


# ─── Transaction dependencies ──────────────────────────────────


def get_transaction_repo(request: Request) -> TransactionRepository:
    return request.app.state.transaction_repo


def get_transaction_service(
    transaction_repo: TransactionRepository = Depends(get_transaction_repo),
    account_repo: AccountRepository = Depends(get_account_repo),
    instrument_repo: InstrumentRepository = Depends(get_instrument_repo),
) -> TransactionService:
    return TransactionService(
        transaction_repo=transaction_repo,
        account_repo=account_repo,
        instrument_repo=instrument_repo,
    )


def get_cash_service(
    transaction_service: TransactionService = Depends(get_transaction_service),
    instrument_service: InstrumentService = Depends(get_instrument_service),
) -> CashService:
    return CashService(
        transaction_service=transaction_service, instrument_service=instrument_service
    )


# ─── Transaction schemas ────────────────────────────────────────


class CreateTransactionRequest(BaseModel):
    account_id: str
    instrument_id: str
    type: TransactionType
    quantity: Decimal
    price: Decimal
    timestamp: datetime


class TransactionResponse(BaseModel):
    id: str
    account_id: str
    instrument_id: str
    type: TransactionType
    quantity: Decimal
    price: Decimal
    timestamp: datetime
    trade_id: str | None


class PositionResponse(BaseModel):
    account_id: str
    instrument_id: str
    share_count: Decimal
    cost_basis: Decimal


def _to_transaction_response(transaction: Transaction) -> TransactionResponse:
    return TransactionResponse(
        id=transaction.id,
        account_id=transaction.account_id,
        instrument_id=transaction.instrument_id,
        type=transaction.type,
        quantity=transaction.quantity,
        price=transaction.price,
        timestamp=transaction.timestamp,
        trade_id=transaction.trade_id,
    )


# ─── Transaction routes ─────────────────────────────────────────
# Transaction ids are server-generated (uuid4) — unlike Instrument/Account,
# a ledger entry has no natural client-chosen identity to deduplicate on.
# Goes through CashService.log_trade, not TransactionService.log_transaction
# directly, so a non-cash BUY/SELL is automatically paired with its CASH
# leg (docs/domain-model.md; UBIQUITOUS_LANGUAGE.md's Cash Balance entry).


@app.post("/transactions", response_model=TransactionResponse, status_code=201)
def create_transaction(
    request: CreateTransactionRequest,
    current_user: User = Depends(get_current_user),
    service: CashService = Depends(get_cash_service),
):
    transaction = Transaction(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        account_id=request.account_id,
        instrument_id=request.instrument_id,
        type=request.type,
        quantity=request.quantity,
        price=request.price,
        timestamp=request.timestamp,
    )
    try:
        service.log_trade(transaction)
    except (AccountNotFoundError, InstrumentNotFoundError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InsufficientSharesError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _to_transaction_response(transaction)


@app.get(
    "/accounts/{account_id}/instruments/{instrument_id}/position",
    response_model=PositionResponse,
)
def get_position(
    account_id: str,
    instrument_id: str,
    current_user: User = Depends(get_current_user),
    service: TransactionService = Depends(get_transaction_service),
):
    position = service.get_position(account_id, instrument_id, user_id=current_user.id)
    if position is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return PositionResponse(
        account_id=position.account_id,
        instrument_id=position.instrument_id,
        share_count=position.share_count,
        cost_basis=position.cost_basis,
    )


# ─── Cash schemas ────────────────────────────────────────────────


class DepositRequest(BaseModel):
    account_id: str
    amount: Decimal = Field(gt=0)
    timestamp: datetime


class WithdrawalRequest(BaseModel):
    account_id: str
    amount: Decimal = Field(gt=0)
    timestamp: datetime


# ─── Cash routes ─────────────────────────────────────────────────
# Deposit/Withdrawal are request-shape labels, not a domain concept — each
# is a BUY/SELL Transaction of the CASH instrument under the hood
# (docs/domain-model.md), so both reuse TransactionResponse and the exact
# same ownership/sufficient-funds validation as any other trade.


@app.post("/transactions/deposit", response_model=TransactionResponse, status_code=201)
def deposit(
    request: DepositRequest,
    current_user: User = Depends(get_current_user),
    service: CashService = Depends(get_cash_service),
):
    try:
        transaction = service.deposit(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            account_id=request.account_id,
            amount=request.amount,
            timestamp=request.timestamp,
        )
    except AccountNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_transaction_response(transaction)


@app.post("/transactions/withdraw", response_model=TransactionResponse, status_code=201)
def withdraw(
    request: WithdrawalRequest,
    current_user: User = Depends(get_current_user),
    service: CashService = Depends(get_cash_service),
):
    try:
        transaction = service.withdraw(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            account_id=request.account_id,
            amount=request.amount,
            timestamp=request.timestamp,
        )
    except AccountNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InsufficientSharesError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _to_transaction_response(transaction)


# ─── Price dependencies ─────────────────────────────────────────


def get_price_history_repo(request: Request) -> PriceHistoryRepository:
    return request.app.state.price_history_repo


def get_price_source(request: Request) -> PriceSource:
    return request.app.state.price_source


def get_price_service(
    price_source: PriceSource = Depends(get_price_source),
    price_history_repo: PriceHistoryRepository = Depends(get_price_history_repo),
    instrument_repo: InstrumentRepository = Depends(get_instrument_repo),
) -> PriceService:
    return PriceService(
        price_source=price_source,
        price_history_repo=price_history_repo,
        instrument_repo=instrument_repo,
    )


def get_query_service(
    account_repo: AccountRepository = Depends(get_account_repo),
    instrument_repo: InstrumentRepository = Depends(get_instrument_repo),
    transaction_repo: TransactionRepository = Depends(get_transaction_repo),
    price_service: PriceService = Depends(get_price_service),
) -> QueryService:
    return QueryService(
        account_repo=account_repo,
        instrument_repo=instrument_repo,
        transaction_repo=transaction_repo,
        price_service=price_service,
    )


# ─── Query schemas ────────────────────────────────────────────


class TimeSeriesPointResponse(BaseModel):
    timestamp: date
    value: Decimal


class SeriesResponse(BaseModel):
    group: str
    points: list[TimeSeriesPointResponse]


# ─── Query routes ─────────────────────────────────────────────
# One generic query answering arbitrary metric x instrument-scope x
# account-scope x granularity x mode breakdowns (docs/domain-model.md),
# instead of a page/endpoint per breakdown combination. `instruments`/
# `accounts` use FastAPI's native repeated-query-param list support — a
# single repeated value of "all", or omitting the param, both mean "no
# filter" (QueryService interprets both the same way). A concrete filter
# is rejected for a dimension that doesn't apply to the metric —
# `accounts` for market_price, `instruments` for cash_balance.


@app.get("/portfolio/query", response_model=list[SeriesResponse])
def query_portfolio(
    metric: Metric,
    start: date,
    end: date,
    granularity: Granularity,
    mode: Mode,
    instruments: list[str] | None = Query(default=None),
    accounts: list[str] | None = Query(default=None),
    group_by: GroupBy = GroupBy.NONE,
    current_user: User = Depends(get_current_user),
    service: QueryService = Depends(get_query_service),
):
    try:
        series = service.query_timeseries(
            user_id=current_user.id,
            metric=metric,
            instruments=instruments,
            accounts=accounts,
            group_by=group_by,
            start=start,
            end=end,
            granularity=granularity,
            mode=mode,
        )
    except (
        InvalidMetricModeError,
        AccountsNotApplicableError,
        InstrumentsNotApplicableError,
    ) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return [
        SeriesResponse(
            group=s.group,
            points=[
                TimeSeriesPointResponse(timestamp=p.timestamp, value=p.value)
                for p in s.points
            ],
        )
        for s in series
    ]


# ─── Health ───────────────────────────────────────────────────


@app.get("/health")
def health():
    return {"status": "ok"}
