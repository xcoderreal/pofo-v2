# Retrospective — Pofo v2 (Portfolio Tracker)

## 1. Which files from CLAUDE.md and docs/ did I actually read, and when?

All read at the start, before writing any code:

- **CLAUDE.md** — Read first. Used it as the primary guide for layering rules, testing philosophy, frontend file org, and the "adding a new resource" pattern.
- **docs/architecture.md** — Read second. Used it for the layer diagram, resource lifecycle (lifespan + app.state), and the "network client adapter" pattern for PriceSource.
- **docs/testing.md** — Read third. Used it for the five-tier pyramid, fixture patterns, Playwright web test conventions, and the adapter conformance testing approach.
- **docs/experiments/05_pofo_v2.md** — Read at the very start (it's the spec).

I did not read `docs/philosophy.md`, `docs/vercel.md`, `docs/bootstrap.md`, or `docs/pinned-versions.md` — none were needed for this task.

## 2. Which `just` recipes did I run, in order?

The environment didn't have `just` installed, so I ran the equivalent commands directly:

1. `uv sync --all-extras` — Install Python deps (needed httpx for tests)
2. `uv run pytest tests/unit/ -v` — Inner loop, ran repeatedly as I wrote domain + service
3. `uv run pytest tests/unit/ tests/integration/ -v` — After writing API routes
4. `uv run pytest tests/smoke/ -v` — Smoke tests with spawned uvicorn
5. `uv run pytest tests/e2e/ -v` — Full e2e coverage
6. `uv run ruff format src/ tests/` — Fix line-length violations
7. `uv run ruff check src/ tests/` — Verify lint clean
8. `bun install` — Frontend deps
9. `bunx tsc --noEmit` — TypeScript check (ran several times)
10. `bun test tests/unit/` — Frontend unit tests
11. `bunx expo lint` — Mobile linting
12. `uv run python -c "...openapi..."` + `bunx openapi-typescript` — Regenerate API types
13. `bunx playwright install chromium` — Failed (no network download available)

## 3. Architectural decisions I made that weren't in the spec

### Multi-repo service orchestration
The spec says "PortfolioService" but doesn't say how to wire a service that takes 3 repositories + a price source. I followed the existing pattern of `@dataclass` services and made `PortfolioService` take all 4 dependencies via its constructor. The `get_service` Depends function takes 4 sub-dependencies. This works but is more verbose than the single-repo pattern the skeleton demonstrates.

### domain/portfolio.py as a separate module
The spec says FIFO lot matching should be in `domain/` but doesn't say where exactly. I put it in `domain/portfolio.py` as pure functions rather than methods on models. This keeps `model.py` clean (just data definitions) and makes the pure computation functions independently testable.

### Positions aggregated by instrument by default
When no `account_id` is specified, positions are grouped by instrument across all accounts (account_id=None). When `account_id` is specified, positions show per-account detail. This matches the "how is AAPL doing across all my accounts?" use case.

### Single dynamic route for drill-down
Instead of separate pages for account detail vs instrument detail, I used a single `portfolio/[slug].tsx` route that parses the slug to determine the filter type. The slug format is `account-{id}` or `instrument-{id}`. This keeps the codebase DRY — the same PositionTable and GainsSummary components work regardless of the filter.

### Sell validation at the service layer
The service layer validates that a sell doesn't exceed available shares (computed via FIFO). This returns a ValueError that the entrypoint maps to HTTP 400. The domain layer has the pure FIFO logic; the service layer adds the validation constraint.

### Yahoo Finance API for prices
Chose Yahoo Finance's chart endpoint (`v8/finance/chart/{ticker}`) as the price source. It's free, unauthenticated, and returns `regularMarketPrice` in the response metadata. Cached in the adapter with a 5-minute TTL. The constructor accepts injectable `httpx.Client` and `now_fn` for testing.

### API types as strings for enums and dates
Transaction type ("buy"/"sell") and account type ("brokerage"/"cash") are strings in the API schema rather than enum types. Dates are ISO strings. This simplifies the frontend — no enum parsing needed, and the backend converts to/from domain enums in the entrypoint layer.

## 4. Rules I noticed in CLAUDE.md but had to consciously work around

### "Replace the existing Item + Category scaffolding"
This was straightforward — I deleted all Item/Category files and tests. The only tricky part was that the old `test_api.py` had specific fixture names (`repo`, `category_repo`) that I replaced entirely.

### "The domain must stay framework-free"
No issues here. `domain/model.py` is pure dataclasses, `domain/portfolio.py` is pure functions, and `domain/repository.py` + `domain/price_source.py` are ABCs. Zero third-party imports.

### "FakeRepository, not mocks"
Strictly followed. Created FakeAccountRepository, FakeInstrumentRepository, FakeTransactionRepository, and FakePriceSource. Zero `unittest.mock` usage anywhere.

### "Pages are thin"
Most screens are under 120 lines. The longest is `transactions/new.tsx` at about 115 lines due to the form fields. The dashboard (`index.tsx`) is also longer because it has 5 sections, but data fetching is all hooks — no business logic in the page.

## 5. Questions I wanted to ask but didn't — how did I decide?

### "Should positions be stored or computed?"
The spec clearly says "computed, not stored" so I didn't ask. But I wondered about performance — recomputing FIFO for every GET /positions is O(n log n) per instrument group. For a personal tracker with <10k transactions, this is fine. I'd ask if we were building for institutional scale.

### "How should the multi-repo service be wired in Depends?"
The skeleton only shows single-repo services. I extended the pattern to take 4 dependencies. Could have asked if there's a preferred pattern for multi-repo orchestration, but the extension was natural.

### "Should the frontend show real prices?"
The FakePriceSource returns fixed prices for tests, but in production the Yahoo adapter would make real HTTP calls. I didn't wire up "use FakePriceSource in dev mode" — the memory adapter is already dev-only. For a real deploy you'd want the Yahoo adapter.

### "Is the Expo web export enough to test, or do I need the dev server?"
The Playwright tests use the exported bundle per the existing config. I didn't change this approach.

## 6. What would I add to CLAUDE.md or docs/ based on building this?

### Multi-repo service pattern
Document how to wire a service that takes 2+ repositories. The skeleton's single-repo `ItemService` doesn't show this. Suggested: add a note about `PortfolioService(account_repo=..., instrument_repo=..., transaction_repo=..., price_source=...)` and the corresponding `get_service` that pulls multiple deps.

### Computed resources (not CRUD)
Positions and capital gains are computed endpoints, not CRUD. The hooks section should mention how to handle computed resources that don't need create/delete mutations — just a query with optional filter params.

### Cross-resource cache invalidation
When a transaction is created, it affects positions, gains, and history. The hook invalidates all four query keys. This pattern (mutation on resource A invalidates queries for computed resources B, C, D) should be documented.

### Dynamic drill-down routes
The `portfolio/[slug]` pattern for handling multiple filter dimensions through a single route is useful but not obvious. Worth documenting as a pattern for when you have N filter dimensions but want O(1) route files.

### Multi-entity test reset in Playwright
The `beforeEach` in web tests needs to reset 3 entity types in dependency order (transactions first, then accounts/instruments). This is more complex than the single-entity reset in the scaffold. Document the pattern and the ordering constraint.
