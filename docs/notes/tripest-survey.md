# Tripest survey

Surveyed 2026-04-11 (code + docs, thorough). Trip planning app — scheduling, transit routing, accommodation, place search.

## What it is
Monorepo: Next.js (web) + Expo (mobile) + FastAPI (backend) + packages/shared/ (data layer). Complex domain: multi-day trip scheduling, transit providers (Google, NAVITIME), place search (Yelp, Google Maps), booking.

## Backend (hexagonal, Protocol-based)
- **typing.Protocol ports** (not ABC) — duck typing for structural subtyping, zero-cost fake swapping
- Layering: `routers/` → `domain/services/` → `domain/ports/` ← `adapters/`
- Domain entities: `@dataclass` only. API models: Pydantic `BaseModel` only. SA models: `Mapped[T]`.
- Services via constructor injection; routes via `Depends()`
- Composition root: `create_app()` factory wires adapters → ports → services → routes
- Semantic type aliases: `MinutesOffset`, `FareAmount`, `DistanceMeters` (never raw int/str)
- Pure function scheduling: `generate_pins_for_day()`, `derive_zones()`, `_deduplicate_and_rank()` — 100% pure, zero I/O
- Async everywhere: `httpx.AsyncClient`, `AsyncSession`, fakes use `await asyncio.sleep(0)`

## Frontend architecture
- **TanStack Query v5** (server state) + **Jotai** (UI ephemeral state) — the winning combo
- Custom hooks: `useTrips()`, `useTrip(id)`, `useSchedulingQuery()` wrap `useQuery`
- Mutations: `useCreateTrip()` uses `useMutation` + `onSuccess: invalidateQueries`
- Service container: `createServiceContainer()` → `ServiceProvider` → `useXxxService()` → `useXxxQuery()`
- Screens call hooks. Hooks call services. Services call API SDK. Clean chain.
- Auto-generated API SDK from OpenAPI (hey-api)

## File organization
```
# Mobile (apps/mobile/src/)
screens/        — flat, screen-specific components as siblings
components/     — shared UI, extract when 2+ screens use
navigation/     — RootNavigator (tab + stack composition)
providers/      — UI contexts (AuthProvider)
hooks/          — native/UI hooks ONLY
# data hooks stay in packages/shared/

# Web (apps/web/app/)
page.tsx        — thin server wrapper, imports screen component
components/     — web-specific shared UI

# Shared (packages/shared/src/) — THE KEY
services/       — interfaces + implementations
hooks/          — TanStack Query wrappers (data hooks)
providers/      — ServiceProvider, data contexts
test-utils/     — builders, fakes
# NO JSX, NO rendering, NO CSS — data layer ONLY
```

## Testing (strongest of all repos)
- Backend: **unit** (pure domain, ≥90% coverage gate) + **contract** (fakes conform to Protocol) + **integration** (routes + fakes via dependency_overrides)
- Contract tests: `isinstance(Fake*, Protocol)` structural conformance mandatory. Behavioral contracts planned.
- Frontend: vitest (web) + jest-expo (mobile). Storybook for visual regression.
- Fake services for ALL ports — FakeTripRepository, FakePlaceSearchProvider, FakeRouteCalculator
- `polyfactory` for test data generation, `respx` for HTTP mocking

## Docs (most comprehensive, zero doc-code divergence)
- **CLAUDE.md** — entry point, points to docs/design/tech/INDEX.md
- **INDEX.md** (47KB) — full architecture, tech decisions
- **CONVENTIONS.md** — import rules, type safety, named types, boundary discipline
- **TESTING.md** — pyramid, coverage gates, examples
- **DI_ARCHITECTURE.md** — DI patterns for backend + frontend
- **FRONTEND_ARCH.md** — TS monorepo boundaries, hook/service patterns
- **None discipline**: required fields MUST NOT have defaults. Resolve absence at ONE boundary.
- **Error handling per layer**: adapters catch → domain exception, services raise, routers map to HTTP
- **`yield`-based deps MUST log and re-raise** or errors silently vanish

## Best patterns
1. **TanStack Query + Jotai** — server cache + UI state, clean separation
2. **Contract tests for fakes** — prevents fake drift, catches interface changes
3. **Service container factory** — one `createServiceContainer()` centralizes all DI
4. **packages/shared/ = data only, no JSX** — clean boundary
5. **Semantic type aliases** — domain-meaningful types prevent confusion
6. **None discipline** — resolve at boundary, pass non-nullable downstream
7. **Error handling per layer** — adapters catch, services raise, routers map
8. **Coverage gates** — 90% domain, 80% overall
9. **Pure function domain logic** — scheduling, ranking, dedup all pure
10. **Auto-generated API SDK** (hey-api) from OpenAPI

## Antipatterns
1. Incomplete Google Maps normalizer (stubbed)
2. Mobile auth flow incomplete
3. Possible N+1 queries in booking service
4. Storybook mock setup manual per-story (no centralized story provider)

## Verdict
Gold standard for architecture, testing, and documentation. The TanStack Query + hooks + service container pattern is the one to adopt. Contract tests for fakes is a novel pattern none of the other repos have. Docs ARE the architecture — zero divergence.
