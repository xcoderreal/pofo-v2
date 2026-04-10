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

To add a new resource (say, `User`), create files in this exact order:

1. **`domain/model.py`** — add the `User` dataclass
2. **`domain/repository.py`** — add `UserRepository` abstract class
3. **`adapters/memory_repository.py`** — add `MemoryUserRepository` implementing it
4. **`service/user_service.py`** — business logic, depends on `UserRepository` interface
5. **`tests/fake_repository.py`** — add `FakeUserRepository`
6. **`tests/test_user_service.py`** — unit tests against `FakeUserRepository`
7. **`entrypoints/api.py`** — Pydantic request/response, `get_repo`/`get_service` dependencies, route handlers
8. **`tests/test_api.py`** — integration tests via `TestClient` + `dependency_overrides`

Mimic the existing `Item` / `ItemRepository` / `ItemService` / routes as your template. Keep the dependency injection pattern consistent: `get_repo()` returns the concrete adapter (cached with `@lru_cache` so in-memory state persists); `get_service()` takes `repo` via `Depends()`.

## Testing philosophy

- **Use `FakeRepository`, not mocks.** No `unittest.mock`, no `@patch`. Fake adapters implement the same ABC as real ones and behave like a real store. This catches bugs mocks hide (interface drift, ordering assumptions, etc.).
- **Integration tests use fixtures, not module-level overrides.** See `tests/test_api.py` — the `client` fixture installs a fresh `FakeItemRepository` for each test so state doesn't leak across tests but *does* persist across requests within a test.
- **Every new endpoint gets a round-trip test.** POST → GET → see it. This is what `dependency_overrides` + fixtures enable.

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

## Commands (auto-allowed in `.claude/settings.json`)

```bash
just test          # pytest + tsc --noEmit across both apps
just check         # lint + format-check (read-only, matches CI)
just fmt           # apply ruff format + expo lint --fix
just lint          # lint only
just test-api      # backend only (faster iteration)
just test-mobile   # frontend typecheck only
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
- [`docs/vercel.md`](docs/vercel.md) — deploy flow, env vars, gotchas
- [`docs/pinned-versions.md`](docs/pinned-versions.md) — Expo SDK 54 version pins (critical)
