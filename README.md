# turbo-skeleton

Opinionated full-stack skeleton for cross-platform apps (web + iOS). Drop in your domain model, swap the in-memory repository for a real one, and ship.

## Stack

| Layer | Tech |
|---|---|
| Monorepo | [Turborepo](https://turbo.build/) + [Bun](https://bun.sh/) workspaces |
| Backend | [FastAPI](https://fastapi.tiangolo.com/) + [UV](https://docs.astral.sh/uv/) (Python 3.12+) |
| Frontend | [Expo](https://expo.dev/) SDK 54 + [expo-router](https://docs.expo.dev/router/introduction/) (React Native 0.81) |
| Deployment | [Vercel](https://vercel.com/) (single project: static frontend + Python serverless) |
| CI | GitHub Actions (lint, typecheck, test, deploy) |

**Backend architecture:** Cosmic Python Chapter 13 DI pattern — pure domain, abstract repository, service layer, thin entrypoints. See [`docs/architecture.md`](docs/architecture.md) for rationale.

## Prerequisites

- [Bun](https://bun.sh/) ≥ 1.3
- [UV](https://docs.astral.sh/uv/) (Python package manager)
- Python 3.12+
- [just](https://github.com/casey/just) (optional — all commands also work directly)

## Quick start

```bash
# Install everything (bun workspaces + Python venv)
just install

# Run frontend + backend together (Turbo TUI)
just dev          # web at http://localhost:8091, API at http://localhost:8090
just dev-ios      # same, but iOS simulator instead of web
```

That's it. The frontend at `localhost:8091` talks to the API at `localhost:8090` automatically (see `apps/mobile/lib/api.ts` for the adaptive base URL logic).

## Directory layout

```
turbo-skeleton/
├── apps/
│   ├── api/                      # FastAPI backend
│   │   ├── src/myapp/
│   │   │   ├── domain/           # Pure dataclasses + abstract repository
│   │   │   ├── service/          # Business logic orchestration
│   │   │   ├── adapters/         # Concrete repository implementations
│   │   │   ├── entrypoints/      # FastAPI routes + DI wiring
│   │   │   └── config.py         # pydantic-settings (env vars)
│   │   └── tests/                # Fake-repository based tests (no mocks)
│   └── mobile/                   # Expo app
│       ├── app/                  # expo-router file-based routes
│       └── lib/api.ts            # API client (adaptive localhost/LAN/prod)
├── api/index.py                  # Vercel serverless entry point
├── docs/
│   ├── architecture.md           # Design decisions & rationale
│   └── pinned-versions.md        # Expo SDK 54 version pins (critical)
├── .github/workflows/            # CI (frontend.yml, backend.yml, deploy-backend.yml)
├── justfile                      # Command shortcuts
├── package.json                  # Bun workspaces + root React/metro overrides
├── turbo.json                    # Task orchestration
└── vercel.json                   # Single-project deploy config
```

## Commands

### Via `just` (recommended)

```bash
just install     # bun install + uv sync
just dev         # turbo dev:web (frontend + backend, TUI)
just dev-ios     # turbo dev:ios
just api         # backend only (uvicorn, port 8090)
just api-test    # pytest
just api-lint    # ruff check
just api-format  # ruff format
just api-setup   # uv sync --all-extras
```

### Direct commands

```bash
# Backend
cd apps/api
uv sync --all-extras
uv run uvicorn myapp.entrypoints.api:app --reload --host 0.0.0.0 --port 8090
uv run pytest
uv run ruff check src/ tests/
uv run ruff format src/ tests/

# Frontend
cd apps/mobile
bun install                 # (or from root)
bunx expo start --web --port 8091
bunx expo start --ios --port 8091
bunx expo export --platform web
bunx tsc --noEmit           # typecheck
bunx expo lint
```

## Manual end-to-end verification

```bash
# 1. Install
just install

# 2. Start backend (keep this running in another terminal)
just api

# 3. Smoke test the API
curl http://localhost:8090/health
curl -X POST http://localhost:8090/items \
  -H "Content-Type: application/json" \
  -d '{"id":"t1","name":"Test","description":"Hello","tags":["demo"]}'
curl http://localhost:8090/items
curl http://localhost:8090/items/t1
curl "http://localhost:8090/items?tag=demo"

# 4. Run backend tests
just api-test

# 5. Start frontend (in another terminal)
cd apps/mobile && bunx expo start --web --port 8091
# Open http://localhost:8091 — should render the item list from the API

# 6. Frontend typecheck + lint
cd apps/mobile && bunx tsc --noEmit && bunx expo lint
```

## Customizing for your project

This skeleton ships with a placeholder `Item` domain. To adapt it:

1. **Rename the Python package:** `apps/api/src/myapp/` → `apps/api/src/yourproject/`. Update references in:
   - `apps/api/pyproject.toml` (`packages = [...]`)
   - `apps/api/package.json` (scripts)
   - `api/index.py` (Vercel entry)
   - `justfile` (api target)
   - Tests

2. **Replace the domain model:** Rewrite `domain/model.py` and `domain/repository.py` with your entities.

3. **Add adapters:** Implement `ItemRepository` (or your renamed variant) for your storage — SQLite, Postgres, Supabase, etc. Swap it in `get_repo()` in `entrypoints/api.py`.

4. **Update env prefix:** Change `MYAPP_` in `config.py` to match your project name.

5. **Update Expo app metadata:** `apps/mobile/app.json` (`name`, `slug`, `bundleIdentifier`).

See [`docs/architecture.md`](docs/architecture.md) for the full rationale behind each layer and how to scale up.

## Deployment

Push to `main` triggers:
- **Frontend CI** (`apps/mobile/**` changes): lint, typecheck, build-web
- **Backend CI** (`apps/api/**` changes): ruff lint/format, pytest
- **Backend deploy** (`apps/api/**` changes): Vercel production deploy

Required GitHub secrets for Vercel deploy: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

See `vercel.json` for the build command (single project serves both frontend and backend).

## Gotchas

- **Do NOT upgrade `react-native-reanimated` past 4.1.1** without checking `docs/pinned-versions.md`. 4.1.6+ pulls incompatible worklets.
- **Do NOT add the reanimated babel plugin manually** — `babel-preset-expo` handles it. Adding it causes "property is not writable" on iOS.
- **Use `npx expo install <pkg>` for native packages**, not `bun add` — Expo resolves SDK-compatible versions.
- **Vercel needs Node 22.x**, not 24.x.
- **Use `npx expo export`**, not `bunx --bun expo export` — Metro doesn't exit cleanly under bun.

## Credits

Architecture extracted from [big-wheel](https://github.com/xcoderreal/big-wheel), a restaurant-roulette app. See `docs/architecture.md` for the layering rationale.
