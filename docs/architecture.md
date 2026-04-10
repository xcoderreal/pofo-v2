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

5. **Testing without mocks.** Tests use `FakeRepository` (an in-memory implementation of the abstract repository). No `unittest.mock`, no `@patch` — just a real object that implements the same interface. This catches bugs that mocks hide.

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

### Adding a new adapter

To add a database-backed repository (e.g., SQLite):

1. Create `adapters/sqlite_repository.py` implementing `ItemRepository`
2. Change `get_repo()` in `entrypoints/api.py` to return `SqliteItemRepository()`
3. Done. No other files change.

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
| `backend.yml` | `apps/api/**` | lint (ruff), test (pytest) |
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
