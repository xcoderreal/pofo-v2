# Testing

The skeleton uses a four-tier test pyramid. Each tier answers a different
question and runs independently, so you can opt into the right level of
rigor for the change you're making.

## The tiers

| Tier | Directory | Answers | I/O | Speed | Runs on |
|---|---|---|---|---|---|
| **Unit** | `apps/api/tests/unit/` | "Is the domain/service logic right?" | None (FakeItemRepository) | <100ms/test | Every save, every PR |
| **Integration** | `apps/api/tests/integration/` | "Is the full app wired correctly?" | ASGI in-process (`TestClient`) | <500ms/test | Every save, every PR |
| **Smoke** | `apps/api/tests/smoke/` | "Is the deploy severely broken?" | Real HTTP | <5s total | Every deploy, prod heartbeat |
| **E2E** | `apps/api/tests/e2e/` | "Is any feature broken?" | Real HTTP | 10–60s total | Push to main, nightly |

**Smoke vs e2e:** smoke is what you'd cron against prod every 5 minutes
without blinking — one health check, one list, one 404, one round-trip.
E2E is comprehensive — every endpoint, every filter, every error path.
Different intent, different schedule.

## Which tier does a new test belong in?

```
Is it pure Python logic (no HTTP, no FastAPI)?
├── Yes → unit/
└── No ↓

Does it go through FastAPI but not over real sockets?
├── Yes → integration/ (use TestClient + dependency_overrides)
└── No ↓

Is it the "is prod alive" critical path?
├── Yes → smoke/
└── No → e2e/
```

When in doubt, prefer the lower tier. A unit test that catches a bug in
the service layer is worth more than an e2e test that catches the same bug
30 seconds slower.

## Running tests

```bash
# Fast inner loop — no real HTTP
just test-unit                    # ~0.1s
just test-integration             # ~0.3s

# Real-HTTP tiers — spawn a uvicorn subprocess
just test-smoke-local             # ~1.5s (spawns server on random free port)
just test-e2e-local               # ~2s

# Against an externally-managed URL (your own `just api`, staging, prod)
just test-smoke url=http://127.0.0.1:8090
just test-e2e url=https://staging.example.com

# Everything (full CI equivalent)
just test                         # unit + integration + e2e + mobile typecheck

# Fast pre-commit gate
just verify                       # unit + integration + smoke-local + check
```

## The base_url fixture

Smoke and e2e share `apps/api/tests/conftest.py`. Its `base_url` fixture
has two modes:

- **`SKELETON_E2E_URL` unset** (the default): spawns `uvicorn` on a
  random free port, waits for `/health`, yields the URL, and terminates
  on teardown. You don't have to start anything yourself.
- **`SKELETON_E2E_URL=<url>` set**: yields that URL directly. Use it to
  point at a running `just api`, a PR preview, staging, or prod.

## The allow_writes gate

Write tests (POST, DELETE) are gated by the `allow_writes` session
fixture, which defaults to:

- **True** if the base URL's host is `localhost` or `127.x`
- **False** otherwise

Override with `SKELETON_E2E_ALLOW_WRITES=1`. This is the safety valve
that lets you run `just test-smoke url=https://prod.example.com` as a
cron heartbeat without POSTing junk into your prod database.

## Adding a smoke test

Smoke is the tightest tier — keep it small. A new smoke test should
answer "is this specific thing that always has to work still working?"
Not "is this feature correct in all its edge cases." That's e2e.

Good smoke additions:
- A new top-level endpoint (health of a new service)
- A new auth path that, if broken, locks everyone out
- A new external dependency that could regress silently (e.g. "can we
  reach the database at all")

Don't add smoke tests for:
- Individual field validations (that's integration)
- Error messages (that's integration or e2e)
- Specific tag/filter combinations (that's e2e)

## Adding an e2e test

E2E is the widest tier — comprehensive real-HTTP coverage. A new e2e
test should exercise a full user flow end-to-end, including error paths.
Use `pytest.skip("writes disabled")` when `allow_writes` is False so
read-only runs against prod still pass.

## Running CI workflows locally

```bash
# Equivalent to backend.yml
cd apps/api && uv run ruff check src/ tests/ && uv run ruff format --check src/ tests/
cd apps/api && uv run pytest tests/unit/
cd apps/api && uv run pytest tests/integration/
cd apps/api && uv run pytest tests/smoke/ -v

# Equivalent to e2e.yml (push to main + nightly)
cd apps/api && uv run pytest tests/e2e/ -v

# Equivalent to heartbeat.yml (disabled by default)
cd apps/api && SKELETON_E2E_URL=https://your-prod-url uv run pytest tests/smoke/ -v
```

## Philosophy

- **Fakes, not mocks.** `FakeItemRepository` implements the same ABC as
  the real adapter. This catches interface drift that `@patch` hides.
- **Every endpoint gets an integration round-trip.** POST → GET → see
  it. That's what `dependency_overrides` + fixtures enable.
- **Smoke is a deploy check, not a feature check.** If a smoke test gets
  flaky, move it to e2e, don't make the flakiness tolerable.
- **Nothing ships until `just verify` is green.** `verify` is the fast
  pre-commit gate (unit + integration + smoke-local + lint). E2E and
  mobile typecheck run via `just test` and CI.

## What's deliberately NOT in this setup

See `docs/test-pyramid-plan.md` for the full list and rationale. Short
version: no factory libraries, no frozen time, no VCR, no hypothesis, no
mutation testing, no contract tests. Add them when the skeleton has a
concrete need — not before.
