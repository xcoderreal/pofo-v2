# Pofo essence (survey notes)

Captured 2026-04-11 from two Explore subagent surveys of `/Users/chunh/git_projects/pofo/`. Not committed — working notes for the experiment ladder.

## What it is

Personal **portfolio / investment tracker**. Users add brokerage + cash accounts, log buy/sell trades, see positions, unrealized gains, capital gains tax. Real domain problem with real math, not a reference app.

## Stack

**Backend:** Python 3.10+, FastAPI, SQLModel (ORM + Pydantic hybrid), SQLite + Alembic migrations, pytest, mypy strict, `uvicorn`.

**Frontend:** Next.js 14, React 18, TypeScript, TanStack Query + React Table, **Jotai** (atom state), Recharts, Tailwind + shadcn/ui.

**External:** `yfinance` (price feeds), MCP (Model Context Protocol — Claude can query/manipulate the portfolio via tools + resources).

## Scale

- ~10,900 Python LOC, ~8,900 TS LOC
- 13 REST endpoints, 6 core entities, 15 pages, 52 React components, 50+ test files

## Architecture alignment (re-surveyed against skeleton improvements)

### What's already aligned

| Capability | Status | Notes |
|---|---|---|
| Domain: stdlib only | **Pass** | Clean dataclasses in `domain/models/`, no frameworks |
| Type story (SQLModel) | **Pass** | Clean separation: dataclass domain, SQLModel in `infrastructure/persistence/entities.py` |
| MCP integration | **Pass** | Tools correctly call service-layer functions, set context via `ServiceContext` |
| Entity mapping | **80% done** | `infrastructure/persistence/mappers.py` exists, needs to be exhaustive |

### What needs refactoring to match skeleton patterns

| Gap | Current pofo | Skeleton pattern | Effort |
|---|---|---|---|
| **yfinance adapter location** | ABC (`ExternalPriceProvider`) + concrete (`YFinanceProvider`) both in `services/current_price_service.py` | ABC in `domain/price_source.py`, concrete in `adapters/yfinance_price_source.py` | 2 files, ~30 min |
| **yfinance injection** | Module-level singleton `_default_provider = YFinanceProvider()` | Injected via `lifespan` + `app.state` + `Depends` | 3 files, ~30 min |
| **Service → adapter imports** | `services/current_price_service.py:13` imports `yfinance` directly | Service takes `PriceSource` ABC, never imports adapter deps | Part of above |
| **DI/context system** | Contextvars-based (`shared/context.py`, set via middleware) | `lifespan` + `app.state` + `Depends(get_repo)` | Optional — contextvars work, just less explicit |
| **Repository ABC** | None — services call `Repository(EntityClass)` directly | ABC in `domain/repository.py`, service depends on interface | Bigger lift: ~2 hours |

### Gaps CLOSED by recent skeleton improvements

- **lifespan + app.state** — pofo uses contextvars + middleware, which is valid but less explicit. The skeleton now documents the preferred pattern clearly. Migration path is clear.
- **Network-client adapter guide** — the yfinance adapter refactoring now has a documented pattern to follow (architecture.md § "If the adapter is a network client").
- **Capability-naming convention** — pofo already named it `ExternalPriceProvider` (capability, not vendor). Just needs to move files.
- **OpenAPI → TS codegen** — pofo's Next.js frontend manually defines API types. The skeleton's `gen-api-types` recipe would replace those with generated types.

### What would be HARD to port (shortest list)

1. **Move yfinance ABC to domain + concrete to adapters** — 2 files, straightforward
2. **Inject price_source into service** — refactor `current_price_service.py` to accept `PriceSource` parameter
3. **Add repository ABCs** — bigger lift; pofo currently hardcodes `Repository(TransactionEntity)` in services. Need ABCs for `TransactionRepository`, `AccountRepository`, etc. in `domain/`, with concrete implementations in `infrastructure/persistence/`
4. **MCP tools use `Session(engine)` directly** — should use lifespan-managed session instead

**No fundamental architecture issues.** Pofo needs tighter adherence to adapter placement and injection patterns, not a redesign. Estimated total: 4–6 hours of focused refactoring.

## Hard features (beyond vanilla CRUD)

1. **Capital gains** — FIFO lot matching, realized + unrealized gains, cost basis tracking
2. **Double-entry ledger** — 4 transactions per user action, UI filters system transactions
3. **Live price feeds** — yfinance + historical price storage
4. **MCP server** — full tools + resources exposing portfolio to Claude
5. **Multi-step forms** — add-transaction wizard (account → instrument → qty/price)
6. **Instrument catalog** — create/manage tickers with price-history backfill

**NOT present:** file uploads, payments, websockets/realtime, background jobs.
