from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from myapp.adapters.memory_repository import (
    MemoryAccountRepository,
    MemoryInstrumentRepository,
    MemoryTransactionRepository,
)
from myapp.adapters.yahoo_price_source import YahooPriceSource
from myapp.domain.model import (
    Account,
    AccountType,
    Instrument,
    Transaction,
    TransactionType,
)
from myapp.domain.price_source import PriceSource
from myapp.domain.repository import (
    AccountRepository,
    InstrumentRepository,
    TransactionRepository,
)
from myapp.service.portfolio_service import PortfolioService


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.account_repo = MemoryAccountRepository()
    app.state.instrument_repo = MemoryInstrumentRepository()
    app.state.transaction_repo = MemoryTransactionRepository()
    price_source = YahooPriceSource()
    app.state.price_source = price_source
    yield


app = FastAPI(title="Pofo", description="Portfolio tracker API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Dependencies ─────────────────────────────────────────────


def get_account_repo(request: Request) -> AccountRepository:
    return request.app.state.account_repo


def get_instrument_repo(request: Request) -> InstrumentRepository:
    return request.app.state.instrument_repo


def get_transaction_repo(request: Request) -> TransactionRepository:
    return request.app.state.transaction_repo


def get_price_source(request: Request) -> PriceSource:
    return request.app.state.price_source


def get_service(
    account_repo: AccountRepository = Depends(get_account_repo),
    instrument_repo: InstrumentRepository = Depends(get_instrument_repo),
    transaction_repo: TransactionRepository = Depends(get_transaction_repo),
    price_source: PriceSource = Depends(get_price_source),
) -> PortfolioService:
    return PortfolioService(
        account_repo=account_repo,
        instrument_repo=instrument_repo,
        transaction_repo=transaction_repo,
        price_source=price_source,
    )


# ─── Account schemas ─────────────────────────────────────────


class AccountResponse(BaseModel):
    id: str
    name: str
    account_type: str


class CreateAccountRequest(BaseModel):
    id: str
    name: str
    account_type: str = "brokerage"


# ─── Instrument schemas ──────────────────────────────────────


class InstrumentResponse(BaseModel):
    id: str
    ticker: str
    name: str


class CreateInstrumentRequest(BaseModel):
    id: str
    ticker: str
    name: str


# ─── Transaction schemas ─────────────────────────────────────


class TransactionResponse(BaseModel):
    id: str
    account_id: str
    instrument_id: str
    type: str
    quantity: float
    price: float
    date: str


class CreateTransactionRequest(BaseModel):
    id: str
    account_id: str
    instrument_id: str
    type: str
    quantity: float
    price: float
    date: str


# ─── Position schemas ────────────────────────────────────────


class PositionResponse(BaseModel):
    instrument_id: str
    account_id: str | None = None
    quantity: float
    cost_basis: float
    cost_basis_per_share: float
    current_price: float | None = None
    market_value: float | None = None
    unrealized_gain: float | None = None


# ─── Capital gains schemas ───────────────────────────────────


class RealizedGainResponse(BaseModel):
    sell_transaction_id: str
    buy_transaction_id: str
    quantity: float
    buy_price: float
    sell_price: float
    gain: float


# ─── Portfolio history schemas ───────────────────────────────


class DailyValueResponse(BaseModel):
    date: str
    market_value: float
    cost_basis: float


# ─── Converters ──────────────────────────────────────────────


def _to_account_response(acct: Account) -> AccountResponse:
    return AccountResponse(
        id=acct.id, name=acct.name, account_type=acct.account_type.value
    )


def _to_instrument_response(inst: Instrument) -> InstrumentResponse:
    return InstrumentResponse(id=inst.id, ticker=inst.ticker, name=inst.name)


def _to_transaction_response(txn: Transaction) -> TransactionResponse:
    return TransactionResponse(
        id=txn.id,
        account_id=txn.account_id,
        instrument_id=txn.instrument_id,
        type=txn.type.value,
        quantity=txn.quantity,
        price=txn.price,
        date=txn.date.isoformat(),
    )


# ─── Account routes ──────────────────────────────────────────


@app.get("/accounts", response_model=list[AccountResponse])
def list_accounts(service: PortfolioService = Depends(get_service)):
    return [_to_account_response(a) for a in service.list_accounts()]


@app.get("/accounts/{account_id}", response_model=AccountResponse)
def get_account(account_id: str, service: PortfolioService = Depends(get_service)):
    acct = service.get_account(account_id)
    if not acct:
        raise HTTPException(status_code=404, detail="Account not found")
    return _to_account_response(acct)


@app.post("/accounts", response_model=AccountResponse, status_code=201)
def create_account(
    request: CreateAccountRequest,
    service: PortfolioService = Depends(get_service),
):
    acct = Account(
        id=request.id,
        name=request.name,
        account_type=AccountType(request.account_type),
    )
    service.create_account(acct)
    return _to_account_response(acct)


@app.delete("/accounts/{account_id}", status_code=204)
def delete_account(account_id: str, service: PortfolioService = Depends(get_service)):
    if not service.delete_account(account_id):
        raise HTTPException(status_code=404, detail="Account not found")


# ─── Instrument routes ───────────────────────────────────────


@app.get("/instruments", response_model=list[InstrumentResponse])
def list_instruments(service: PortfolioService = Depends(get_service)):
    return [_to_instrument_response(i) for i in service.list_instruments()]


@app.get("/instruments/{instrument_id}", response_model=InstrumentResponse)
def get_instrument(
    instrument_id: str, service: PortfolioService = Depends(get_service)
):
    inst = service.get_instrument(instrument_id)
    if not inst:
        raise HTTPException(status_code=404, detail="Instrument not found")
    return _to_instrument_response(inst)


@app.post("/instruments", response_model=InstrumentResponse, status_code=201)
def create_instrument(
    request: CreateInstrumentRequest,
    service: PortfolioService = Depends(get_service),
):
    inst = Instrument(id=request.id, ticker=request.ticker, name=request.name)
    service.create_instrument(inst)
    return _to_instrument_response(inst)


@app.delete("/instruments/{instrument_id}", status_code=204)
def delete_instrument(
    instrument_id: str, service: PortfolioService = Depends(get_service)
):
    if not service.delete_instrument(instrument_id):
        raise HTTPException(status_code=404, detail="Instrument not found")


# ─── Transaction routes ──────────────────────────────────────


@app.get("/transactions", response_model=list[TransactionResponse])
def list_transactions(
    account_id: str | None = None,
    instrument_id: str | None = None,
    service: PortfolioService = Depends(get_service),
):
    txns = service.list_transactions(account_id=account_id, instrument_id=instrument_id)
    return [_to_transaction_response(t) for t in txns]


@app.get("/transactions/{transaction_id}", response_model=TransactionResponse)
def get_transaction(
    transaction_id: str, service: PortfolioService = Depends(get_service)
):
    txn = service.get_transaction(transaction_id)
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return _to_transaction_response(txn)


@app.post("/transactions", response_model=TransactionResponse, status_code=201)
def create_transaction(
    request: CreateTransactionRequest,
    service: PortfolioService = Depends(get_service),
):
    from datetime import date

    txn = Transaction(
        id=request.id,
        account_id=request.account_id,
        instrument_id=request.instrument_id,
        type=TransactionType(request.type),
        quantity=request.quantity,
        price=request.price,
        date=date.fromisoformat(request.date),
    )
    try:
        service.create_transaction(txn)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return _to_transaction_response(txn)


@app.delete("/transactions/{transaction_id}", status_code=204)
def delete_transaction(
    transaction_id: str, service: PortfolioService = Depends(get_service)
):
    if not service.delete_transaction(transaction_id):
        raise HTTPException(status_code=404, detail="Transaction not found")


# ─── Position routes (computed) ───────────────────────────────


@app.get("/positions", response_model=list[PositionResponse])
def get_positions(
    account_id: str | None = None,
    instrument_id: str | None = None,
    service: PortfolioService = Depends(get_service),
):
    positions = service.get_positions(
        account_id=account_id, instrument_id=instrument_id
    )
    return [
        PositionResponse(
            instrument_id=p.instrument_id,
            account_id=p.account_id,
            quantity=p.quantity,
            cost_basis=p.cost_basis,
            cost_basis_per_share=p.cost_basis_per_share,
            current_price=p.current_price,
            market_value=p.market_value,
            unrealized_gain=p.unrealized_gain,
        )
        for p in positions
    ]


# ─── Capital gains routes (computed) ─────────────────────────


@app.get("/gains", response_model=list[RealizedGainResponse])
def get_realized_gains(
    account_id: str | None = None,
    instrument_id: str | None = None,
    service: PortfolioService = Depends(get_service),
):
    gains = service.get_realized_gains(
        account_id=account_id, instrument_id=instrument_id
    )
    return [
        RealizedGainResponse(
            sell_transaction_id=g.sell_transaction_id,
            buy_transaction_id=g.buy_transaction_id,
            quantity=g.quantity,
            buy_price=g.buy_price,
            sell_price=g.sell_price,
            gain=g.gain,
        )
        for g in gains
    ]


# ─── Portfolio history (computed) ─────────────────────────────


@app.get("/history", response_model=list[DailyValueResponse])
def get_portfolio_history(
    account_id: str | None = None,
    service: PortfolioService = Depends(get_service),
):
    history = service.get_portfolio_history(account_id=account_id)
    return [
        DailyValueResponse(
            date=h.date.isoformat(),
            market_value=h.market_value,
            cost_basis=h.cost_basis,
        )
        for h in history
    ]


# ─── Health ──────────────────────────────────────────────────


@app.get("/health")
def health():
    return {"status": "ok"}
