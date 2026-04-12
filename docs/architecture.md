# Architecture

This skeleton follows an opinionated full-stack architecture designed for building cross-platform apps (web + iOS) that can scale incrementally.

## Monorepo: Turborepo + Bun

**Why Turborepo?** It provides task orchestration (parallel dev servers, cached builds) without imposing project structure. Unlike Nx, it stays out of your way — no codegen, no plugins, just a `turbo.json` that defines task dependencies.

**Why Bun?** Fast installs, built-in workspace support, and native TypeScript execution. The `packageManager` field in root `package.json` pins the version for CI reproducibility.

**Workspace layout:**
```
apps/
  api/      → Python (FastAPI) backend
  mobile/   → React Native (Expo) frontend
api/        → Vercel serverless entry point
```

The `apps/*` glob in root `package.json` makes each app a workspace. Turbo discovers tasks via each app's `package.json` scripts.

## Backend: Cosmic Python (Chapter 13 DI)

The backend follows the architecture from "Architecture Patterns with Python" (Percival & Gregory), specifically the Chapter 13 dependency injection pattern. This is intentionally opinionated.

### Why this pattern?

1. **Domain stays pure.** `domain/model.py` contains plain dataclasses with zero framework imports. Business rules are testable without FastAPI, databases, or any I/O.

2. **Repository abstraction.** `domain/repository.py` defines an abstract interface. Concrete implementations (memory, YAML, SQLite, Supabase — whatever) live in `adapters/`. Swapping storage is a one-line change in the DI wiring.

3. **Service layer.** `service/` orchestrates domain logic. It depends on the repository *interface*, not a concrete implementation. This is where business workflows live.

4. **Entrypoints are thin.** `entrypoints/api.py` does three things: defines request/response schemas (Pydantic), wires dependencies via `Depends()`, and delegates to the service layer. No business logic here.

5. **Testing without mocks.** Tests use `FakeRepository` (an in-memory implementation of the abstract repository). No `unittest.mock`, no `@patch` — just a real object that implements the same interface. This catches bugs that mocks hide. See [`docs/testing.md`](testing.md) for the five-tier test pyramid (unit → integration → smoke → e2e → web).

### Layer rules

| Layer | Imports from | Never imports |
|-------|-------------|---------------|
| `domain/` | stdlib only | service, adapters, entrypoints |
| `service/` | domain | adapters, entrypoints |
| `adapters/` | domain | service, entrypoints |
| `entrypoints/` | domain, service, adapters | — |

The dependency arrow always points inward: entrypoints → service → domain ← adapters.

### File structure

```
apps/api/src/myapp/
├── config.py              # pydantic-settings (env vars)
├── domain/
│   ├── model.py           # Pure dataclasses, no framework deps
│   └── repository.py      # Abstract repository (ABC)
├── service/
│   └── item_service.py    # Business logic orchestration
├── adapters/
│   └── memory_repository.py  # Concrete repository implementation
└── entrypoints/
    └── api.py             # FastAPI routes + DI wiring
```

### Layering: invariant core, swappable edges

The middle of the stack is written once and never rewritten when you swap a backend or an auth scheme. The edges are where stack choices live.

```
  ┌───────────────────────────────────────────────────────────────┐
  │                     SWAPPABLE EDGE (top)                      │
  │                                                               │
  │   identity source  →  get_current_user()  →  domain User      │
  │   · hand-rolled JWT · pyjwt · Supabase JWKS                   │
  │   · session cookie  · reverse-proxy header  · dev stub        │
  └──────────────────────────┬────────────────────────────────────┘
                             │ owner_id: str
  ╔══════════════════════════▼════════════════════════════════════╗
  ║                     INVARIANT CORE                            ║
  ║                                                               ║
  ║   entrypoints/   thin route handlers                          ║
  ║        │                                                      ║
  ║   service/      takes owner_id: str, returns domain objects   ║
  ║        │                                                      ║
  ║   domain/       @dataclass Item, User; ItemRepository (ABC)   ║
  ║        ▲                                                      ║
  ╚════════╪══════════════════════════════════════════════════════╝
           │ implements
  ┌────────┴──────────────────────────────────────────────────────┐
  │                   SWAPPABLE EDGE (bottom)                     │
  │                                                               │
  │   storage backend  →  <Name>ItemRepository                    │
  │   · Memory · SQLite · Postgres · Supabase · Redis · Dynamo    │
  └───────────────────────────────────────────────────────────────┘
```

**Four rules keep the core invariant:**

1. **Auth lives in `entrypoints/`.** `get_current_user` is the *only* place that parses identity. It returns a domain `User`. Nothing downstream imports from it — the service and domain layers never learn whether auth is JWT, cookies, or a proxy header.

2. **Services take `owner_id: str`, never `User` or `Request`.** This is what keeps the service layer framework-free *and* auth-scheme-free. A service signature is identical whether you're running against memory, SQLite, or Supabase.

3. **Ownership is a repository concern, not a service concern.** Every read/write in the repository ABC that touches owned data takes `owner_id`. Services never filter post-hoc. This is what makes an RLS migration free: a `SupabaseItemRepository` can pass `owner_id` to `.eq()` *or* rely on Postgres row-level security and ignore the parameter — the service doesn't know or care.

4. **The ABC fits the 90% case. The 10% case customizes its adapter.** Don't design the repository interface for every backend and every feature you might one day need. Design it for the common CRUD shape (get, list, add, delete) and let edge cases add methods to their *specific* adapter, wired through a single service method — not through the ABC.

**The rule of three for growing the ABC.** First caller with an edge-case need (pagination, batch insert, upsert, full-text search, …) solves it as a one-off on their adapter. Second caller copies the pattern. Third caller promotes it into the ABC. This is the same heuristic as "three similar lines beats a premature abstraction" — applied to the repository contract.

**What this means for the usual suspects:**

- **Pagination** — not in the ABC. Defer until a `list_*` call is actually slow or actually exceeds a reasonable response size. When it shows up, the first caller picks a style (offset vs cursor) that fits their access pattern. Preemptive pagination designs almost always get rewritten.
- **Transactions** — not in the ABC. The skeleton trusts per-method atomicity (which every real DB provides on a single statement). If a concrete multi-step atomic requirement appears ("create order + decrement inventory"), introduce Cosmic Python's Unit of Work pattern at the **service** layer — it wraps existing repositories without changing their interfaces.
- **Batch ops** — not in the ABC by default. If a caller needs to insert N items efficiently, they either loop (fine up to hundreds) or add `add_many` to their specific adapter. Don't conflate batch ("do N things efficiently") with transaction ("do N things atomically") — they're different problems with different solutions.

**Why this is stack-independent in practice.** Every backend on the swappable-edge list has a natural implementation for the 90% ABC shape: relational backends use `WHERE owner_id = ?`, key-value backends use `owner_id` as a partition key, document stores use it as a filter. The skeleton doesn't pretend every backend is equally ergonomic — it admits it's optimized for relational-ish CRUD (which is 90%+ of real apps) and lets the 10% customize locally.

### Adding a new adapter

To add a database-backed repository (e.g., SQLite):

1. Create `adapters/sqlite_repository.py` implementing `ItemRepository`
2. Change `get_repo()` in `entrypoints/api.py` to dispatch on a `Settings` field (e.g. `repository: str = "memory"`) so the adapter is selectable via env var, not code change
3. Add the new env vars to `apps/api/.env.sample` so they're discoverable (CLAUDE.md spells this out — every new `Settings` field needs a corresponding documented entry)
4. Add unit tests under `apps/api/tests/unit/adapters/` using `tmp_path` (or equivalent) for isolation per test. **See [`docs/testing.md` § "Where adapter conformance lives"](testing.md#where-adapter-conformance-lives)** for the parametrize-over-adapters pattern that lets one test file cover both `Memory` and your new adapter.
5. The smoke and e2e tiers will exercise the new adapter automatically when the env var is set — no test rewrites required. The smoke/e2e fixtures spawn `uvicorn` as a subprocess that **inherits the parent shell's environment**, so `MYAPP_REPOSITORY=sqlite just test-smoke-local` swaps the adapter for that run with no fixture changes.
6. Done. The domain and service layers should not change.

**Threading note for sync I/O adapters.** FastAPI runs sync route handlers in a threadpool. Most database clients (`sqlite3`, `psycopg`, `redis-py`, etc.) are not safe to share across threads without specific configuration (e.g. `sqlite3` requires `check_same_thread=False`, and even then a single connection is a contention point). For low-traffic services, the simplest correct pattern is **a fresh client per call** inside the repository — no shared state, no thread-safety concerns. If you need pooling later, that's a separate decision driven by load, not a default. Document the choice in the adapter's class docstring so the next reader doesn't have to re-derive it.

**Why this still doesn't violate "no abstraction for hypothetical needs."** Each new adapter is a one-file addition implementing an existing interface. You don't add the abstraction speculatively — you add the adapter when you need it, and the existing `ItemRepository` ABC absorbs it without any wider change.

### Adding a new service method

1. Add domain model changes in `domain/model.py` if needed
2. Add the method to `service/item_service.py`
3. Add the route in `entrypoints/api.py`
4. Add a test using `FakeItemRepository`

## Frontend: Expo SDK 54 + expo-router

**Why Expo?** Single codebase for iOS + web. Expo manages the React Native toolchain (Metro bundler, native modules, build service) so you don't.

**Why expo-router?** File-based routing (like Next.js). Drop a file in `app/`, get a route. No manual route registration.

**Why these exact versions?** See `docs/pinned-versions.md`. Expo SDK 54 has specific version requirements for reanimated, worklets, and metro-runtime. Getting these wrong causes runtime crashes on iOS that are extremely hard to debug.

### Key config decisions

- **`metro.config.js`**: Configured for monorepo — watches the root, deduplicates React to prevent "property is not writable" errors on iOS.
- **`babel.config.js`**: Single preset (`babel-preset-expo`). Do NOT manually add the reanimated plugin — the preset handles it.
- **Root overrides**: `react`, `react-dom`, and `@expo/metro-runtime` are pinned at the root to force a single copy across the monorepo.

### API client (`lib/api.ts`)

The API client auto-detects the environment:
- **localhost**: Direct to `http://localhost:8090`
- **LAN (192.168.x.x)**: Same host, port 8090 (for testing on physical devices)
- **Production (Vercel)**: Same-origin, path `/api`
- **Android emulator**: `10.0.2.2:8090` (Android's localhost alias)

No environment variables needed for dev. Set `EXPO_PUBLIC_API_URL` to override.

## Deployment: Vercel

Single Vercel project hosts both frontend and backend:

- **Frontend**: Static export via `expo export --platform web` → `apps/mobile/dist/`
- **Backend**: Python serverless function at `api/index.py`
- **Routing**: `/api/*` rewrites to the serverless function; everything else serves the static frontend

The `api/index.py` entry point mounts the FastAPI app under `/api` and sets up `sys.path` so that:
1. Packages installed via `pip install -t api/` are importable
2. The backend source at `apps/api/src/` is importable

### Gotchas

- Use `npx expo export`, not `bunx --bun expo export` — Metro doesn't exit cleanly with bun
- Python packages must be installed to `api/` directory (not site-packages) for correct Linux binaries on Vercel
- Vercel requires Node.js 22.x (not 24.x)

## CI/CD: GitHub Actions

Three workflows, each scoped to its app's file paths:

| Workflow | Trigger | Jobs |
|----------|---------|------|
| `frontend.yml` | `apps/mobile/**` | lint, typecheck, build-web |
| `backend.yml` | `apps/api/**` | lint (ruff), test-unit, test-integration, test-smoke |
| `e2e.yml` | push to main + nightly cron | test-e2e-local |
| `heartbeat.yml` | manual / cron (disabled by default) | smoke against prod URL |
| `deploy-backend.yml` | push to main + `apps/api/**` | Vercel deploy |

## Package Managers

| Tool | Scope | Purpose |
|------|-------|---------|
| **Bun** | Root + frontend | JS/TS packages, workspace management |
| **UV** | Backend | Python packages, virtualenv, script runner |
| **npx/bunx** | CLI tools | Expo CLI, Turbo CLI (not installed globally) |

## Scaling up

This skeleton is designed to grow:

- **New API resources**: Add domain model → repository method → service method → route. Four files, each in its layer.
- **New adapter**: Implement the repository interface. Swap in `get_repo()`.
- **New frontend screens**: Drop a `.tsx` file in `app/`. expo-router picks it up.
- **Shared types**: If backend and frontend need shared type definitions, consider a `packages/shared` workspace with TypeScript types generated from Pydantic models.
- **Additional apps**: Add to `apps/` — Turbo discovers them automatically via the workspace glob.
