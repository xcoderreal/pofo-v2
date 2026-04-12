# Build Log — Pofo v2 (Portfolio Tracker)

## 1 — Read spec and existing codebase
**Why:** Understand requirements and skeleton patterns before writing code
**Outcome:** Read docs/experiments/05_pofo_v2.md, CLAUDE.md, docs/architecture.md, docs/testing.md. Mapped all existing scaffolding files (domain, service, adapters, entrypoints, tests, frontend). Understand the layering rules, DI pattern, test pyramid, and frontend conventions.

## 2 — Plan domain design
**Why:** Need to decide on models, where computed logic lives, and API shape before coding
**Outcome:** Decisions:
- Domain models: Account, Instrument, Transaction (stored); Lot, Position, CapitalGain (computed dataclasses)
- FIFO lot matching: pure function in domain/model.py (or domain/portfolio.py)
- Capital gains: pure function in domain/, computed from transactions
- PriceSource ABC in domain/price_source.py
- Repos: AccountRepository, InstrumentRepository, TransactionRepository
- Service: PortfolioService taking all 3 repos + PriceSource
- API: single endpoints with optional query params (account_id, instrument_id) for positions/gains
- UI: single dashboard with progressive drill-down

## 3 — Write domain layer
**Why:** Foundation for everything else — models, FIFO logic, ABCs
**Outcome:** Created domain/model.py (Account, Instrument, Transaction, Lot, RealizedGain, Position, PortfolioSummary, DailyValue), domain/portfolio.py (FIFO lot matching, position computation, realized gains — all pure functions), domain/repository.py (3 ABCs), domain/price_source.py (PriceSource ABC)

## 4 — Write adapters + service
**Why:** Implement concrete repos + Yahoo price source + orchestration service
**Outcome:** Created adapters/memory_repository.py (3 memory repos), adapters/yahoo_price_source.py (with TTL cache, injectable client+clock), service/portfolio_service.py (takes 3 repos + price source, validates sells, computes positions/gains/history)

## 5 — Write unit tests
**Why:** Verify FIFO math and service logic before wiring API
**Outcome:** 34 unit tests: 16 for domain/portfolio.py (FIFO lots, capital gains, positions, filtering), 18 for portfolio_service (CRUD + computed views). Fixed one test assertion (expected 4 gains, correct is 3). All pass.

## 6 — Write entrypoints + integration/smoke/e2e tests
**Why:** Complete the backend — API routes, full test pyramid
**Outcome:** Replaced Item+Category scaffolding entirely. API has /accounts, /instruments, /transactions, /positions, /gains, /history endpoints. 24 integration tests, 4 smoke tests, 18 e2e tests. All 80 backend tests pass.

## 7 — Write frontend API client + hooks
**Why:** Frontend needs typed API calls and TanStack Query data hooks
**Outcome:** Replaced lib/api.ts (removed Item/Category, added Account/Instrument/Transaction/Position/RealizedGain/DailyValue). Created 6 hook files: useAccounts, useInstruments, useTransactions, usePositions, useGains, useHistory. Transaction mutations invalidate positions+gains+history cache. Removed old useItems, useCategories, ItemCard.

## 8 — Write frontend screens
**Why:** Build the portfolio dashboard with progressive drill-down
**Outcome:** 5 screens total:
- index.tsx: Dashboard with portfolio summary, positions table, drill-down cards for accounts+instruments, realized gains
- accounts.tsx: Account CRUD with type picker (brokerage/cash)
- instruments.tsx: Instrument CRUD with ticker+name
- transactions/new.tsx: Trade form with buy/sell toggle, account/instrument picker, sell validation error display
- portfolio/[slug].tsx: Dynamic drill-down page handling both account-X and instrument-X routes, reuses PositionTable and GainsSummary components
Also created 2 shared components: PositionTable (reusable across any filter slice) and GainsSummary. All with testID props. TypeScript compiles clean.

## 9 — Write Playwright web tests
**Why:** Runtime UI verification in real browser
**Outcome:** Updated smoke.spec.ts (loads without errors), rewrote items.spec.ts with 8 portfolio-specific tests: dashboard overview, empty state, create account, create instrument, log trade, drill-down by account, drill-down by instrument, view capital gains. Each test resets state via API beforeEach. Chromium couldn't be downloaded in this environment.

## 10 — Run verification pipeline
**Why:** Ensure everything is green
**Outcome:** All 80 backend tests pass (unit + integration + smoke + e2e). TypeScript compiles clean. Frontend unit tests pass (16). Linting passes (ruff + expo lint). API types regenerated. Playwright web tests can't run (no Chromium available). Formatting clean.
