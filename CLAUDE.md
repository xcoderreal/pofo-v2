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
| `adapters/` | `domain/` | service, entrypoints |
| `entrypoints/` | all inner layers | — |

**The domain must stay framework-free.** No FastAPI, no Pydantic models, no SQLAlchemy. Plain `@dataclass` only. If you find yourself wanting to put a Pydantic model in `domain/`, it belongs in `entrypoints/` as a request/response schema instead.

## Adding a new resource (the pattern)

**First resource in a fresh fork:** replace the `Item` scaffolding with your new domain (delete `domain/model.py`'s `Item`, `service/item_service.py`, `adapters/memory_repository.py`'s `MemoryItemRepository`, and their tests — then follow the steps below with your new name). The skeleton ships with `Item` as a reference template, not a required base class. Keeping it alongside your first real resource is the "abstraction for a hypothetical second use case" that `Things to avoid` warns against.

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

Mimic the existing `Item` / `ItemRepository` / `ItemService` / routes as your template. Keep the dependency injection pattern consistent: `get_repo()` returns the concrete adapter (cached with `@lru_cache` so in-memory state persists); `get_service()` takes `repo` via `Depends()`.

## Testing philosophy

- **Four-tier pyramid.** `tests/unit/` (domain + service via `FakeRepository`), `tests/integration/` (ASGI in-process via `TestClient`), `tests/smoke/` (real HTTP, critical path), `tests/e2e/` (real HTTP, comprehensive). See [`docs/testing.md`](docs/testing.md) for the full decision tree.
- **Use `FakeRepository`, not mocks.** No `unittest.mock`, no `@patch`. Fake adapters implement the same ABC as real ones and behave like a real store. This catches bugs mocks hide (interface drift, ordering assumptions, etc.).
- **Integration tests use fixtures, not module-level overrides.** See `tests/integration/test_api.py` — the `client` fixture installs a fresh `FakeItemRepository` for each test so state doesn't leak across tests but *does* persist across requests within a test.
- **Every new endpoint gets a round-trip test.** POST → GET → see it. This is what `dependency_overrides` + fixtures enable.

### Which tier does a new test belong in?

| Test asks… | Tier |
|---|---|
| "Is this pure Python logic right?" (no HTTP, no FastAPI) | `tests/unit/` |
| "Is the FastAPI wiring correct?" (validation, deps, routing) | `tests/integration/` |
| "Is the deployed app severely broken?" (health + 1 round-trip) | `tests/smoke/` |
| "Is this endpoint/filter/error-path correct over real HTTP?" | `tests/e2e/` |

When in doubt, prefer the lower tier. Smoke tests should be cronnable against prod without blinking — keep them tight.

### Test file locations

**Unit tier (`tests/unit/`) — strict mirror of the source tree:**

| Source | Test |
|---|---|
| `src/myapp/domain/model.py` | `tests/unit/domain/test_model.py` |
| `src/myapp/service/item_service.py` | `tests/unit/service/test_item_service.py` |
| `src/myapp/adapters/memory_repository.py` | `tests/unit/adapters/test_memory_repository.py` |

Rationale: unit tests target one module's pure logic. Mirroring makes "where does the test for X live?" trivially answerable as the codebase grows.

**Integration / smoke / e2e tiers — flexible:**

These tiers are cross-cutting by nature — a single test often exercises the router + service + adapter + real HTTP serialization. Organize tests by feature, flow, or scenario, whichever reads most naturally. Flat directories are fine until a tier has 5+ files; then group into subdirectories (`tests/e2e/items/`, `tests/e2e/auth/`).

**Exceptions:**
- Trivial modules (`__init__.py`, pure type/config declarations) don't need test files
- `tests/fake_repository.py` and other shared helpers live at `tests/` root — they're fixtures, not tests
- A single source module may split across multiple test files once tests exceed ~300 lines; the primary test file keeps the mirrored path, siblings are named descriptively (`test_item_service_edge_cases.py`)

## Frontend — stale Metro bundles are a common trap

If the user reports that UI changes aren't showing up, or that the page shows content that doesn't match the source (wrong header, wrong empty state, wrong text), **assume a stale Metro bundle before debugging the code**. Expo caches aggressively and a hot reload isn't always enough.

Recovery:
- `just clean` to wipe Metro cache, `.expo/`, and `dist/`
- `just dev-web-clean` to start the dev server with `--clear`
- Tell the user to hard-reload the browser (Cmd+Shift+R on macOS)

Only dig into the source if a fresh bundle still shows the wrong content.

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
just test              # pytest + tsc --noEmit across both apps
just check             # lint + format-check (read-only, matches CI)
just fmt               # apply ruff format + expo lint --fix
just lint              # lint only
just verify            # fast gate: unit + integration + smoke-local + check
just test-api          # backend only (all tiers)
just test-unit         # unit tier only (fastest inner loop)
just test-integration  # integration tier only
just test-smoke-local  # smoke tier, spawns uvicorn
just test-e2e-local    # e2e tier, spawns uvicorn
just test-mobile       # frontend typecheck only
```

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

See `scripts/init-project.py` for what exactly gets renamed. Then edit `README.md` and `docs/` by hand, detach from skeleton history (`rm -rf .git && git init`), and verify with `just test && just check`.

## Doc pointers

- [`docs/architecture.md`](docs/architecture.md) — design decisions & layer rationale
- [`docs/testing.md`](docs/testing.md) — four-tier test pyramid (unit → integration → smoke → e2e)
- [`docs/bootstrap.md`](docs/bootstrap.md) — install + worktree troubleshooting
- [`docs/vercel.md`](docs/vercel.md) — deploy flow, env vars, gotchas
- [`docs/pinned-versions.md`](docs/pinned-versions.md) — Expo SDK 54 version pins (critical)
