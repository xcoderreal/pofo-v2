# Test Pyramid Plan

Living plan for introducing a four-tier test structure (unit → integration → smoke → e2e) into the skeleton. Written as a reviewable checklist so we can iterate on the shape before any code moves.

**Status:** all phases complete. Phases 1–5 landed as individual commits on the branch. See [`docs/testing.md`](testing.md) for the resulting developer-facing guide.

## Goal

Give the skeleton an opinionated test strategy that scales from "is the code right" (unit) all the way to "is the deployed app working" (e2e against prod), without forcing a SQL adapter or any persistence convention.

## Principles

1. **Four tiers, clear boundaries.** Each tier answers a different question; each runs independently.
2. **No SQL, no ORM, no mapper scaffolding in this plan.** The repository ABC is already the abstraction. Multi-table assembly (when needed later) lives inside a repository's `get`/`add` methods, not in a shared module.
3. **Explicit URL args for smoke/e2e.** A developer running an e2e recipe should never be ambiguous about whether they're hitting local, staging, or prod.
4. **Smoke is a subset of e2e in intent, a sibling in structure.** Smoke catches "severely broken"; e2e catches "some feature is broken." Different directories, different schedules.
5. **Nothing ships until `just verify` stays green** after each phase.

## Tier definitions

| Tier | Directory | What it tests | I/O | Speed | Runs on |
|---|---|---|---|---|---|
| Unit | `tests/unit/` | Domain + service logic against `FakeItemRepository` | None | <100ms/test | Every save |
| Integration | `tests/integration/` | Full app wiring via `TestClient` + `dependency_overrides` (in-process) | ASGI in-process | <500ms/test | Every save |
| Smoke | `tests/smoke/` | Critical path only (health + one round-trip) over real HTTP | Real sockets | <5s total | Every deploy + prod heartbeat |
| E2E | `tests/e2e/` | Comprehensive real-HTTP coverage of every endpoint + edge cases | Real sockets | 10–60s total | Main branch, nightly, pre-release |

**Key distinction smoke vs e2e:** smoke is what you'd run as a cron every 5 minutes against prod without blinking. E2E is what you'd run before a release.

## Target directory layout

```
apps/api/tests/
├── __init__.py
├── conftest.py                    # [Phase 2] shared base_url fixture for smoke + e2e
├── fake_repository.py             # stays at root (shared across unit + integration)
│
├── unit/                          # [Phase 1] move test_item_service.py here
│   ├── __init__.py
│   └── test_item_service.py
│
├── integration/                   # [Phase 1] move test_api.py here
│   ├── __init__.py
│   └── test_api.py
│
├── smoke/                         # [Phase 1] create empty + __init__.py
│   └── __init__.py                # [Phase 2] populate with test_critical_path.py
│
└── e2e/                           # [Phase 1] create empty + __init__.py
    └── __init__.py                # [Phase 2] populate with test_items.py
```

## Phase 1 — Restructure (this is what I'm about to do)

### Scope
File moves only. No new code. No new recipes. Current tests (20) keep passing in their new homes.

### Steps

1. **Create subdirectories** in `apps/api/tests/`:
   - `unit/`, `integration/`, `smoke/`, `e2e/`
   - Each gets a `__init__.py` (empty)

2. **Move existing tests** with `git mv` to preserve history:
   - `tests/test_item_service.py` → `tests/unit/test_item_service.py`
   - `tests/test_api.py` → `tests/integration/test_api.py`

3. **`fake_repository.py` stays at `tests/` root** — both tiers import it via `from tests.fake_repository import FakeItemRepository`. No import changes needed because Python's module resolution is package-relative.

4. **Verify imports still resolve.** The moved files import `from tests.fake_repository` which works from any subdirectory because `tests/` is a package rooted at `apps/api/`.

5. **Update `apps/api/pyproject.toml`** — no change needed. `testpaths = ["tests"]` already discovers subdirectories recursively.

6. **Update `justfile`**:
   - Keep `test-api` recipe unchanged (runs all tests in `apps/api/tests/`, which now means unit + integration via discovery)
   - Add `test-unit` and `test-integration` as new granular recipes
   - Do NOT add smoke/e2e recipes yet — those come in Phase 3

7. **Run `just verify`** — all 20 existing tests must still pass.

### Files touched in Phase 1

| File | Action |
|---|---|
| `apps/api/tests/test_item_service.py` | git mv to `tests/unit/` |
| `apps/api/tests/test_api.py` | git mv to `tests/integration/` |
| `apps/api/tests/unit/__init__.py` | create (empty) |
| `apps/api/tests/integration/__init__.py` | create (empty) |
| `apps/api/tests/smoke/__init__.py` | create (empty, populated Phase 2) |
| `apps/api/tests/e2e/__init__.py` | create (empty, populated Phase 2) |
| `justfile` | add `test-unit` and `test-integration` recipes |

### Success criteria

- `just verify` exit 0
- `just test-unit` runs 5 tests (the existing `test_item_service.py` ones)
- `just test-integration` runs 15 tests (the existing `test_api.py` ones)
- Git log shows the moves as renames (not delete + add)

### Rollback

Everything in Phase 1 is reversible with `git reset --hard HEAD~1`. No data loss, no external state changed.

## Phase 2 — Build smoke + e2e infrastructure

### Scope
~200 lines of new code. No file moves. Introduces real-HTTP testing.

### Steps (sketch)

1. **`tests/conftest.py`** — shared `base_url` fixture:
   - Reads `SKELETON_E2E_URL` env var
   - If set: yields the URL directly (BYO server / prod)
   - If unset: spawns `uvicorn` subprocess on a random free port, waits for `/health`, yields URL, terminates on teardown
   - Also exposes `http_client` fixture (`httpx.Client`) pointing at `base_url`
   - Plus `allow_writes` fixture that defaults to True for localhost/127.x URLs and False for non-local URLs unless `SKELETON_E2E_ALLOW_WRITES=1`

2. **`tests/smoke/test_critical_path.py`** — 4 tests:
   - `test_health` — GET /health returns `{"status":"ok"}`
   - `test_list_endpoint_reachable` — GET /items returns a list (no content assertions)
   - `test_create_read_delete_roundtrip` — full round-trip with cleanup (gated by `allow_writes`)
   - `test_unknown_route_404` — GET /nonexistent returns 404 (not HTML from a misconfigured proxy)

3. **`tests/e2e/test_items.py`** — comprehensive:
   - Every endpoint (health, list, get, post, delete if present)
   - Every filter param (tag, pagination if we add it later)
   - Every error path (404, 422, invalid JSON, missing fields)
   - Writes gated by `allow_writes`
   - Cleanup in fixtures (collected test IDs, deleted in teardown)

### Success criteria
- `just test-smoke-local` passes (spawns subprocess, 4 smoke tests green)
- `just test-e2e-local` passes (spawns subprocess, 20+ e2e tests green)
- `just test-smoke url=http://127.0.0.1:8090` passes when `just api` is running separately

## Phase 3 — `just` recipes and `verify` composite

### Scope
~30 lines of justfile changes. Zero code changes.

### Recipes to add

```just
# Granular (Phase 1 adds test-unit + test-integration; Phase 3 adds the rest)
test-unit:
    cd apps/api && uv run pytest tests/unit/

test-integration:
    cd apps/api && uv run pytest tests/integration/

test-smoke url:
    SKELETON_E2E_URL={{url}} cd apps/api && uv run pytest tests/smoke/ -v

test-smoke-local:
    cd apps/api && uv run pytest tests/smoke/ -v

test-e2e url:
    SKELETON_E2E_URL={{url}} cd apps/api && uv run pytest tests/e2e/ -v

test-e2e-local:
    cd apps/api && uv run pytest tests/e2e/ -v

# Composite — fast gate for pre-commit / PR
verify: test-unit test-integration test-smoke-local check
```

### What `just verify` becomes
- Before: `test + check + smoke` (shell-based smoke)
- After: `test-unit + test-integration + test-smoke-local + check`
- Runtime: ~10-15 seconds instead of ~30 (smoke-local is tighter than the old shell smoke)

### Recipes to remove
- Old shell-based `smoke` recipe in justfile — replaced by `test-smoke-local` which uses pytest + httpx with better assertions
- Old `test: test-api test-mobile` stays, but `test-api` now means "everything under tests/" which includes all tiers

## Phase 4 — CI wiring

### Scope
Update `.github/workflows/backend.yml`, add `.github/workflows/e2e.yml`, sketch `.github/workflows/heartbeat.yml`.

### Workflow matrix

| Workflow | Trigger | Jobs |
|---|---|---|
| `backend.yml` | PR + push to main (backend changes) | lint, test-unit, test-integration, test-smoke-local |
| `e2e.yml` | Push to main + nightly cron | test-e2e-local |
| `heartbeat.yml` | Cron every 5 min (commented out by default) | `just test-smoke url=<prod>` |

### Service expansion (future)
The heartbeat workflow's env has placeholder comments showing where a prod URL would go. The e2e workflow has a commented-out `services:` block showing how to add Postgres/Redis/Supabase when the user eventually adds a non-memory adapter.

## Phase 5 — Documentation

### New docs
- `docs/testing.md` — the tier decision table, "when to write what," how to add a smoke test, how to run against prod
- `docs/adding-an-adapter.md` — Memory + Supabase + SQLAlchemy(+mappers) examples showing where multi-table assembly goes (inside the repository, not in shared mappers)
- Update `CLAUDE.md` — new "Which tier does a new test belong in?" decision table

### Existing docs to update
- `README.md` — update the Commands section with the new granular recipes
- `docs/architecture.md` — brief note pointing at `docs/testing.md` for the test-tier discussion

## Open questions

None right now — previous rounds settled them. For the record:

- **SQL adapter:** not added. Repository ABC is the abstraction. Multi-table assembly lives inside the repository.
- **`DB_MODE` env var:** not added. Too much machinery without a SQL adapter.
- **Smoke vs e2e split:** sibling directories, four recipes (smoke and e2e × local and url).
- **URL arg:** required, no magic sentinels.
- **Jest / frontend test tier:** deferred until we have a second thing to test beyond `resolveApiBaseUrl()`.

## Rollout order

Phase 1 → 2 → 3 → 4 → 5, one commit per phase. Each phase leaves `just verify` green. Rollback is a single `git reset --hard` per phase.

Total effort: ~4 hours, spread across small focused commits.

## What's explicitly NOT in this plan

- Factory libraries (factory_boy) — add when test setup genuinely needs them
- Frozen time / deterministic random — add when a test actually depends on time or randomness
- Recorded HTTP (VCR/cassettes) — the skeleton has no external HTTP calls to record
- Property-based tests (hypothesis) — orthogonal; add when you want them
- Mutation testing / coverage gates — orthogonal; add when the test suite is mature enough to benefit
- Contract tests (Pact, OpenAPI-based) — add if you have multiple independent consumers of the API
- Auth-aware test fixtures — add when the skeleton has auth

Each of these might be useful later. None are essential to the "have a real test pyramid" outcome.
