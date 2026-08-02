# Claude guidelines for this repo

This is `turbo-skeleton` — an opinionated full-stack monorepo (Turborepo + Bun, FastAPI + UV, Expo SDK 54). It's designed as a reusable starting point for cross-platform (web + iOS) apps.

Read [`docs/architecture.md`](docs/architecture.md) before making non-trivial changes. It explains *why* each layer exists.

## Backend architecture — Cosmic Python DI (non-negotiable)

The backend (`apps/api/src/myapp/`) follows Chapter 13 of "Architecture Patterns with Python". The layering is enforced by convention, not tooling — **don't break it**.

```
entrypoints/ → service/ → domain/ ← adapters/
```

Layer import rules:

| Layer | May import from | Must NOT import |
|---|---|---|
| `domain/` | stdlib only | service, adapters, entrypoints, fastapi, pydantic, sqlalchemy, etc. |
| `service/` | `domain/` | adapters, entrypoints |
| `adapters/` | `domain/` + adapter-specific runtime deps (`httpx`, `sqlite3`, etc.) | service, entrypoints |
| `entrypoints/` | all inner layers + `fastapi`, `pydantic`, `uvicorn` | — |

**The domain must stay framework-free.** No FastAPI, no Pydantic models, no SQLAlchemy. Plain `@dataclass` only. If you find yourself wanting to put a Pydantic model in `domain/`, it belongs in `entrypoints/` as a request/response schema instead.

**Resource lifecycle: `lifespan` + `app.state`, not `@lru_cache`.** Long-lived resources (repositories, external API adapters, DB pools) are created in the `lifespan` hook, held on `app.state`, and pulled into route handlers via `Depends(get_repo)` where `get_repo(request: Request)` reads from `request.app.state.repo`. See [`docs/architecture.md` § "Resource lifecycle"](docs/architecture.md#resource-lifecycle) for the full diagram.

## Adding a new resource (the pattern)

**First resource in a fresh fork:** replace the `Item` + `Category` scaffolding with your new domain (delete domain models, services, adapters, and their tests — then follow the steps below with your new names). The skeleton ships with `Item` + `Category` as reference templates demonstrating single-entity and FK-related patterns, not required base classes.

**Subsequent resources:** add alongside using the pattern below. Don't touch the existing ones.

To add a new resource (say, `User`), create files in this exact order:

1. **`domain/model.py`** — add the `User` dataclass
2. **`domain/repository.py`** — add `UserRepository` abstract class
3. **`adapters/memory_repository.py`** — add `MemoryUserRepository` implementing it
4. **`service/user_service.py`** — business logic, depends on `UserRepository` interface
5. **`tests/fake_repository.py`** — add `FakeUserRepository`
6. **`tests/unit/service/test_user_service.py`** — unit tests against `FakeUserRepository` (mirror path)
7. **`entrypoints/api.py`** — Pydantic request/response, `get_repo`/`get_service` dependencies, route handlers
8. **`tests/integration/test_user_api.py`** — integration tests via `TestClient` + `dependency_overrides`
9. **`tests/e2e/test_users.py`** — real-HTTP coverage for the new endpoints (see `docs/testing.md`)

Mimic the existing `Item` + `Category` / `ItemRepository` + `CategoryRepository` / `ItemService` + `CategoryService` / routes as your template. The skeleton ships both as a reference for single-entity and FK-related resources. Keep the dependency injection pattern consistent: repos are created in `lifespan` on `app.state`; `get_repo(request)` reads from `request.app.state`; `get_service()` takes `repo` via `Depends()`.

**When you extend `Settings` with new env vars** (e.g. adding a persistence adapter, an external API key, a feature flag), **also add them to `apps/api/.env.sample`** with a comment explaining the choice. The sample file is the discovery surface for "what env vars does this app accept" — config.py alone isn't enough. Mirror the existing entries (`MYAPP_SECRET_KEY`, `MYAPP_PORT`) for the comment style.

## Testing philosophy

- **Five-tier pyramid.** `apps/api/tests/unit/` (domain + service via `FakeRepository`), `apps/api/tests/integration/` (ASGI in-process via `TestClient`), `apps/api/tests/smoke/` (real HTTP, critical path), `apps/api/tests/e2e/` (real HTTP, comprehensive), `apps/mobile/tests/web/` (real browser via Playwright — catches runtime UI errors invisible to tsc). See [`docs/testing.md`](docs/testing.md) for the full decision tree and capabilities.
- **Frontend unit tests.** `apps/mobile/tests/unit/lib/*.test.ts` covers pure-function logic in `lib/` via `bun test`. The same mirror convention as backend unit tests.
- **Use `FakeRepository`, not mocks.** No `unittest.mock`, no `@patch`. Fake adapters implement the same ABC as real ones and behave like a real store. This catches bugs mocks hide (interface drift, ordering assumptions, etc.).
- **Integration tests use fixtures, not module-level overrides.** See `tests/integration/test_api.py` — the `client` fixture installs a fresh `FakeItemRepository` for each test so state doesn't leak across tests but *does* persist across requests within a test.
- **Every new endpoint gets a round-trip test.** POST → GET → see it. This is what `dependency_overrides` + fixtures enable.
- **Every new screen or user flow gets a Playwright web test.** When you add a new screen, user flow, or UI state, extend `apps/mobile/tests/web/` with at least one happy-path spec. The existing `smoke.spec.ts` only asserts "the page loads without `pageerror`" — it won't catch a broken button or a stale list. See [`docs/testing.md` § "Web tier"](docs/testing.md#web-tier--capabilities-and-how-to-extend) for the full Playwright API.
- **Web test conventions.** Use `testID` props on React Native elements for stable Playwright selectors (`data-testid` on web). Web tests run serially (`workers: 1` in `playwright.config.ts`) because the backend's singleton in-memory repo is shared — use `beforeEach` to reset state via the REST API so each test starts from a known baseline.

### Which tier does a new test belong in?

| Test asks… | Tier |
|---|---|
| "Is this pure Python logic right?" (no HTTP, no FastAPI) | `apps/api/tests/unit/` |
| "Is this pure TypeScript logic right?" (no React, no globals) | `apps/mobile/tests/unit/` |
| "Is the FastAPI wiring correct?" (validation, deps, routing) | `apps/api/tests/integration/` |
| "Is the deployed app severely broken?" (health + 1 round-trip) | `apps/api/tests/smoke/` |
| "Is this endpoint/filter/error-path correct over real HTTP?" | `apps/api/tests/e2e/` |
| "Does the browser bundle render without runtime errors?" | `apps/mobile/tests/web/` |

When in doubt, prefer the lower tier. Smoke tests should be cronnable against prod without blinking — keep them tight. The web tier is the only place to catch runtime UI bugs that pass `tsc` and bundle build.

### Test file locations

**Unit tiers — strict mirror of the source tree:**

Backend (`apps/api/tests/unit/`):

| Source | Test |
|---|---|
| `src/myapp/domain/model.py` | `tests/unit/domain/test_model.py` |
| `src/myapp/service/item_service.py` | `tests/unit/service/test_item_service.py` |
| `src/myapp/adapters/memory_repository.py` | `tests/unit/adapters/test_memory_repository.py` |

Frontend (`apps/mobile/tests/unit/`):

| Source | Test |
|---|---|
| `apps/mobile/lib/env-core.ts` | `apps/mobile/tests/unit/lib/env.test.ts` |
| `apps/mobile/lib/foo.ts` (future) | `apps/mobile/tests/unit/lib/foo.test.ts` |

Rationale: unit tests target one module's pure logic. Mirroring makes "where does the test for X live?" trivially answerable as the codebase grows. Same convention applies to both backend (pytest) and frontend (bun test).

For frontend, **separate the pure logic from framework-coupled code** (`lib/env-core.ts` vs `lib/env.ts`) so unit tests don't have to mock `react-native`. The pure file is what `bun test` imports; the adapter file imports framework globals and re-exports the pure API.

**Integration / smoke / e2e / web tiers — flexible:**

These tiers are cross-cutting by nature — a single test often exercises router + service + adapter + real HTTP serialization, or in the web tier's case, the entire bundle running in a browser. Organize tests by feature, flow, or scenario, whichever reads most naturally. Flat directories are fine until a tier has 5+ files; then group into subdirectories (`tests/e2e/items/`, `tests/web/items/`).

**Exceptions:**
- Trivial modules (`__init__.py`, pure type/config declarations) don't need test files
- `tests/fake_repository.py` and other shared helpers live at `tests/` root — they're fixtures, not tests
- A single source module may split across multiple test files once tests exceed ~300 lines; the primary test file keeps the mirrored path, siblings are named descriptively (`test_item_service_edge_cases.py`)

## Frontend file organization

```
app/            — expo-router pages (THIN: call hooks, render components)
components/     — shared UI, extract when 2+ screens use same component
hooks/          — useQuery/useMutation wrappers (one per resource) + useTheme
lib/            — pure logic (api.ts, formatting). ZERO React imports.
utils/          — theme.ts, constants
tests/
  unit/         — bun test on lib/
  web/          — Playwright specs
```

**Pages are thin.** Each screen calls hooks for data, handles loading/error, renders components. No business logic, no direct `fetch`, no direct `lib/api.ts` imports — always go through `hooks/`.

**`hooks/` = data hooks.** One file per resource: `useItems.ts`, `useCategories.ts`. Each exports `useXxx()` (query), `useCreateXxx()` (mutation with cache invalidation). Screens never call `fetchItems()` directly.

**`lib/` has zero React imports.** Everything here is testable with `bun test`. If it needs `useX`, it's a hook.

**Extract components when shared by 2+ screens.** Don't pre-extract. When a component exceeds 300 lines, promote to a folder: `ComponentName/index.tsx + types.ts + sub-components`.

**Theme via `useTheme()`.** `utils/theme.ts` defines colors, spacing, fontSize, borderRadius. `hooks/useTheme.ts` provides it via React Context. Use `useTheme()` in components for consistent styling. Dark mode support is a future `ThemeProvider` value swap.

## Frontend — API types are generated from the backend

`apps/mobile/lib/api-types.ts` is auto-generated from FastAPI's OpenAPI schema via `openapi-typescript`. **Do not edit it by hand.** When you change Pydantic response/request models in the backend, run `just gen-api-types` to regenerate and commit the result. `just verify` includes `check-api-types` which will fail if the committed types don't match what the backend would generate.

`lib/api.ts` imports its types from `api-types.ts` — no manual interface definitions. This prevents backend/frontend type drift (the class of bug where the backend adds a field and the frontend silently ignores it).

## Frontend — stale Metro bundles are a common trap

If the user reports that UI changes aren't showing up, or that the page shows content that doesn't match the source (wrong header, wrong empty state, wrong text), **assume a stale Metro bundle before debugging the code**. Expo caches aggressively and a hot reload isn't always enough.

Recovery:
- `just clean` to wipe Metro cache, `.expo/`, and `dist/`
- `just dev-web-clean` to start the dev server with `--clear`
- Tell the user to hard-reload the browser (Cmd+Shift+R on macOS)

Only dig into the source if a fresh bundle still shows the wrong content.

**`just dev` assumes `just install` has been run.** If you see 500 errors or MIME type refusals when starting the dev server, run `just install` first. This is especially common in fresh clones and new worktrees.

## Frontend — Expo SDK 54 pinned versions are load-bearing

`docs/pinned-versions.md` documents every critical version pin and the specific breakage each prevents. Before running `bun add` or `expo install` on a native/Expo package:

- **Use `npx expo install <pkg>`** for anything native or Expo-adjacent — it resolves SDK-compatible versions
- **`bun add`** is fine for pure-JS packages only
- **Do NOT upgrade `react-native-reanimated` past `4.1.1`** — 4.1.6+ pulls worklets 0.7.x which mismatches Expo Go SDK 54
- **Do NOT add `react-native-reanimated/plugin` to `babel.config.js`** — `babel-preset-expo` handles it; the manual plugin causes "property is not writable" on iOS

## Bootstrap issues → `docs/bootstrap.md`

If verification commands fail on the first step rather than on assertions, the workspace probably needs `just install`. Telltale symptoms:

- `Cannot find module 'eslint'` (from `just lint-mobile` / `test-mobile`)
- `ModuleNotFoundError: No module named 'fastapi'` / `httpx` / `pytest` / `uvicorn`
- Tests pass in the main checkout but fail in a fresh `git worktree` with missing-module errors

See [`docs/bootstrap.md`](docs/bootstrap.md) for the full symptom → fix table. **`git worktree add` does NOT copy `node_modules/` or `.venv/`** — always run `just install` inside a new worktree before verification commands.

## Commands (auto-allowed in `.claude/settings.json`)

```bash
just test                  # pytest + tsc + bun test across both apps
just check                 # lint + format-check (read-only, matches CI)
just fmt                   # apply ruff format + expo lint --fix
just lint                  # lint only
just verify                # the gate: unit + integration + smoke-local + mobile-unit + web-local + check

# Backend tiers
just test-api              # backend only (all tiers)
just test-unit             # backend unit tier (fastest inner loop)
just test-integration      # backend integration tier
just test-smoke-local      # backend smoke tier, spawns uvicorn
just test-e2e-local        # backend e2e tier, spawns uvicorn

# Frontend tiers
just test-mobile           # frontend: typecheck + unit
just test-mobile-typecheck # tsc --noEmit only
just test-mobile-unit      # bun test on tests/unit/
just test-web-local        # web tier: Playwright loads bundle in headless Chromium
```

`just verify` is the canonical "is everything green" command. It runs the full pre-commit gate including the web tier (~20s cold). For the runtime UI capabilities Playwright unlocks (UI mode, trace viewer, debugging), see [`docs/testing.md`](docs/testing.md) § "Web tier — capabilities and how to extend".

For dev servers (interactive, not auto-allowed): `just dev` (web), `just dev-ios`, `just api`.

## Things to avoid

- **Don't add backwards-compat shims.** This is a skeleton — when you change something, change it cleanly.
- **Don't add abstractions for hypothetical future needs.** Three similar lines beats a premature base class. The layer pattern is the only pre-existing abstraction; everything else should be added when a second use case actually appears.
- **Don't put business logic in `entrypoints/`.** Handlers should be thin: parse request → call service → shape response. If a handler has branching, it probably belongs in the service layer.
- **Don't touch `vercel.json` without reading [`docs/vercel.md`](docs/vercel.md).** The `api/` vs `apps/api/` split and the dual `pyproject.toml` + `requirements.txt` are load-bearing for the Vercel deploy.
- **Don't commit `.env`, `.vercel/`, or anything under `api/` except `api/index.py`.** The rest is pip-install output from the Vercel build.

## Forking this skeleton into a new project

```bash
just new-project my_app   # renames 'myapp' → 'my_app' everywhere
```

See `scripts/init-project.py` for what exactly gets renamed. Then edit `README.md` and `docs/` by hand, detach from skeleton history (`rm -rf .git && git init`), and verify with `just verify`.

## Doc pointers

- [`docs/philosophy.md`](docs/philosophy.md) — what this skeleton is, what's baseline vs opt-in, MCP vs test tier
- [`docs/architecture.md`](docs/architecture.md) — design decisions & layer rationale
- [`docs/testing.md`](docs/testing.md) — five-tier test pyramid (unit → integration → smoke → e2e → web) + Playwright capabilities
- [`docs/bootstrap.md`](docs/bootstrap.md) — install + worktree troubleshooting
- [`docs/vercel.md`](docs/vercel.md) — deploy flow, env vars, gotchas
- [`docs/pinned-versions.md`](docs/pinned-versions.md) — Expo SDK 54 version pins (critical)
- [`docs/domain-model.md`](docs/domain-model.md) — portfolio-tracker entities, FIFO invariants, the query interface
- [`docs/environments.md`](docs/environments.md) — auth/persistence toggle matrix, dev-user reseeding
- [`docs/auth.md`](docs/auth.md) — Supabase Auth + JWT + RLS design
- [`docs/security.md`](docs/security.md) — RLS checklist, production access control
- [`docs/deployment.md`](docs/deployment.md) — Vercel + Supabase dev/test/prod, migration promotion
- [`docs/non-goals.md`](docs/non-goals.md) — explicitly deferred features and why
- [`CONTEXT.md`](CONTEXT.md) / [`UBIQUITOUS_LANGUAGE.md`](UBIQUITOUS_LANGUAGE.md) — product context and domain glossary
- [`engineering-principles.md`](engineering-principles.md) — durable engineering taste decisions
