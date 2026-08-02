# Testing

The skeleton uses a **five-tier** test pyramid. Each tier answers a different
question and runs independently, so you can opt into the right level of
rigor for the change you're making.

## The tiers

| Tier | Directory | Answers | I/O | Speed | Runs on |
|---|---|---|---|---|---|
| **Unit** | `apps/api/tests/unit/` | "Is the domain/service logic right?" | None (FakeItemRepository) | <100ms/test | Every save, every PR |
| **Integration** | `apps/api/tests/integration/` | "Is the full app wired correctly?" | ASGI in-process (`TestClient`) | <500ms/test | Every save, every PR |
| **Smoke** | `apps/api/tests/smoke/` | "Is the deploy severely broken?" | Real HTTP | <5s total | Every deploy, prod heartbeat |
| **E2E (backend)** | `apps/api/tests/e2e/` | "Is any feature broken?" | Real HTTP | 10–60s total | Push to main, nightly |
| **Web (runtime UI)** | `apps/mobile/tests/web/` | "Does the browser bundle load without crashing?" | Real browser (Playwright) | ~20s total | Every PR (part of `just verify`) |

**Smoke vs e2e:** smoke is what you'd cron against prod every 5 minutes
without blinking — one health check, one list, one 404, one round-trip.
E2E is comprehensive — every endpoint, every filter, every error path.
Different intent, different schedule.

**Why the web tier exists:** `tsc --noEmit` and `expo export` both pass
cleanly even when the bundle crashes at runtime — e.g., React Native Web
style-shim errors that are invisible to the type checker. The web tier
loads the exported bundle in headless Chromium and asserts no `pageerror`
or `console.error` during render. It's the floor for runtime UI
validation. See also [`philosophy.md`](philosophy.md) for the MCP vs test
tier distinction.

### A sixth, opt-in tier: RLS enforcement proof

`apps/api/tests/rls/` (`just test-rls`) answers a question none of the five
tiers above can: "does a Row Level Security policy actually deny cross-user
access?" It talks to PostgREST directly against a dedicated *test* Supabase
project with two real fixture users' JWTs — never through the FastAPI app,
since the app's `stub` auth path uses the service-role key and structurally
bypasses RLS. Requires `MYAPP_SUPABASE_TEST_URL`/`_ANON_KEY`/`_SERVICE_KEY`;
skips cleanly when absent, so it's deliberately **not** part of `just
verify` — opt in once a test project is provisioned. See `docs/security.md`'s
RLS checklist.

## Which tier does a new test belong in?

```
Is it a frontend runtime assertion (browser render, no crash)?
├── Yes → apps/mobile/tests/web/ (Playwright)
└── No ↓

Is it pure Python logic (no HTTP, no FastAPI)?
├── Yes → apps/api/tests/unit/
└── No ↓

Does it go through FastAPI but not over real sockets?
├── Yes → apps/api/tests/integration/ (TestClient + dependency_overrides)
└── No ↓

Is it the "is prod alive" critical path?
├── Yes → apps/api/tests/smoke/
└── No → apps/api/tests/e2e/
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

# Real-browser tier — exports bundle, serves, runs Chromium
just test-web-local               # ~15-25s cold (Chromium startup + bundle export)

# Frontend unit tier — pure-function logic in apps/mobile/lib/, via bun test
just test-mobile-unit             # ~80ms

# Against an externally-managed URL (your own `just api`, staging, prod)
just test-smoke url=http://127.0.0.1:8090
just test-e2e url=https://staging.example.com

# RLS enforcement proof — opt-in, requires a dedicated test Supabase project
just test-rls                     # skips cleanly if MYAPP_SUPABASE_TEST_* unset

# Everything (full CI equivalent)
just test                         # unit + integration + e2e + mobile typecheck + mobile-unit

# Fast pre-commit gate (default `just`)
just verify                       # unit + integration + smoke-local + mobile-unit + web-local + check
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

## Where adapter conformance lives

When the skeleton grows beyond `MemoryItemRepository` (e.g. you add a `SqliteItemRepository`, a `SupabaseItemRepository`, etc.), tests for the new adapter live in **two places**, not three:

| Question | Tier | How |
|---|---|---|
| "Does this adapter implement `ItemRepository` correctly?" | **Unit** — `apps/api/tests/unit/adapters/test_<name>_repository.py` | Instantiate the adapter against an isolated backing store (`tmp_path` for SQLite, a test schema for Postgres, etc.) and exercise its methods directly |
| "Does the full HTTP flow work against this adapter?" | **Smoke + E2E** — re-run the existing tiers with the env var that selects the new adapter | No new test files needed; the existing smoke/e2e suites are deliberately adapter-agnostic |

**Integration tier deliberately uses `FakeItemRepository` and stays adapter-agnostic.** Don't parametrize integration tests over real adapters — that's the wrong tool. Integration's job is "is the FastAPI wiring correct" (validation, deps, routing), not "does this adapter behave like a repository should." Mixing the two muddies the role and slows the feedback loop.

The adapter conformance unit tests are the contract. The smoke/e2e re-runs prove the contract holds end-to-end. Together, that's the testing story for any new adapter.

**This pattern applies to all capability ABCs, not just storage repositories.** A `PriceSource` adapter gets the same treatment: unit tests in `tests/unit/adapters/test_<vendor>_price_source.py` (using `httpx.MockTransport` or equivalent for network isolation), integration uses `FakePriceSource` via `dependency_overrides`, and smoke/e2e exercise the real adapter through the spawned uvicorn.

**Real-network tests belong in e2e, not smoke.** When an adapter calls a third-party API (Coinbase, yfinance, a weather service), the test that verifies the real upstream works goes in `tests/e2e/`. Smoke must remain cronnable against prod without flakes — external API failures would make it unreliable. The deterministic parser/cache behavior should already be pinned by unit tests against `MockTransport`; e2e only needs one happy-path round-trip. Skip gracefully when the upstream is unreachable.

### Recommended: parametrize the unit tests over both adapters

When you have a real adapter alongside `MemoryItemRepository`, the cleanest pattern is **one test file** that parametrizes over both:

```python
# apps/api/tests/unit/adapters/test_item_repositories.py
import pytest
from myapp.adapters.memory_repository import MemoryItemRepository
from myapp.adapters.sqlite_repository import SqliteItemRepository

@pytest.fixture(params=["memory", "sqlite"])
def repo(request, tmp_path):
    if request.param == "memory":
        return MemoryItemRepository()
    return SqliteItemRepository(database_path=str(tmp_path / "items.db"))

def test_add_then_get(repo):
    ...
```

Each test runs once per adapter; a single conformance failure in either implementation flags clearly. Adapter-specific tests (e.g. SQLite cross-instance persistence) live in sibling files or guarded with `if isinstance(repo, ...)`. This was the pattern the v2 persistence experiment converged on after the v1 separate-file approach felt redundant.

### How env-var swapping works in smoke and e2e

The smoke and e2e tiers spawn `uvicorn` as a subprocess via the `base_url` fixture in `apps/api/tests/conftest.py`. **The subprocess inherits the parent shell's environment** — so any env var you set before invoking `just test-smoke-local` (or `pytest tests/smoke/`) reaches the spawned uvicorn unchanged. That's why `MYAPP_REPOSITORY=sqlite just test-smoke-local` re-runs the entire smoke tier against the SQLite adapter with zero fixture changes.

## Test parallelism by tier

| Tier | Parallel? | Why |
|---|---|---|
| Unit (backend) | Yes | Each test gets a fresh `FakeRepository` via fixture |
| Unit (frontend, `bun test`) | Yes | Pure functions, no shared state |
| Integration (backend) | Yes | Each test gets a fresh repo via `dependency_overrides` fixture |
| Smoke / E2E (backend) | Sequential within tier | Shared uvicorn process with persistent in-memory state |
| Web (Playwright) | Sequential (`workers: 1`) | Shared backend process; each test resets via REST API in `beforeEach` |

The Playwright `workers: 1` setting is in `playwright.config.ts`. Each test file's `beforeEach` re-establishes the baseline via the REST API (today: `POST /demo/seed`, which is idempotent). Tests are **independent** (any can run alone) but **sequential** (to avoid racing on the shared backend).

### Reads before writes: the two Playwright projects

There is no purge endpoint yet (that is #29), and the backend is one
process with an in-memory repository for the whole run — so a spec that
**records** a Transaction permanently changes the row counts and totals
the read-only specs assert exactly (`Accounts · 4`, `20 transactions`,
the Grid's matrix).

`playwright.config.ts` therefore splits the tier into two projects:

| Project | Contains | Runs |
|---|---|---|
| `chromium` | every spec except `transaction-entry.spec.ts` | first |
| `chromium-writes` | `transaction-entry.spec.ts` | after, via `dependencies: ["chromium"]` |

`dependencies` makes the ordering a declared fact rather than an
alphabetical accident of the filenames. A writing spec should still keep
its own blast radius small — `transaction-entry.spec.ts` records into
accounts it creates itself, with a run-unique id, so its assertions never
depend on what a previous run left behind.

Note the interaction with `reuseExistingServer`: a stray `just api` on
`:8090` survives between runs, so a *second* local run against it will see
the first run's writes. Kill it (`lsof -ti tcp:8090 | xargs -r kill -9`)
before `just verify`.

<!-- TODO: frontend hook-level integration tests (renderHook + QueryClientProvider + mocked fetch) — add when hook count exceeds 10 and cache invalidation logic becomes complex -->

## Web tier — capabilities and how to extend

The web tier (`apps/mobile/tests/web/`) uses [Playwright](https://playwright.dev) to load the exported Expo web bundle in headless Chromium and assert that nothing crashes during render. It's the only tier in the pyramid that catches **runtime UI errors** — bugs that pass `tsc --noEmit` and `expo export` but blow up the moment a real browser tries to render the page (CSS shim issues, hydration failures, missing globals, etc.).

### Running

| Command | What it does |
|---|---|
| `just test-web-local` | Builds the bundle, spawns the backend (`uvicorn`) + static frontend (`bunx serve dist`), runs all tests in `tests/web/` headless. ~15-25s cold. |
| `cd apps/mobile && bunx playwright test` | Same as above (the recipe is a thin wrapper). |
| `cd apps/mobile && bunx playwright test --ui` | Interactive UI mode — see each test step, time-travel through actions, inspect DOM at each frame. The best debugging tool. |
| `cd apps/mobile && bunx playwright test --headed` | Run with a visible browser window. Slower than headless but useful when you want to watch the actual page. |
| `cd apps/mobile && bunx playwright test --grep "smoke"` | Run only tests whose name matches the pattern. |
| `cd apps/mobile && bunx playwright test --trace on` | Capture a Playwright trace for every test. Open with `bunx playwright show-trace test-results/.../trace.zip`. Best post-mortem for CI failures. |
| `cd apps/mobile && bunx playwright show-report` | Open the HTML report from the last run. |

### What the test environment looks like

Playwright's `webServer` config (`apps/mobile/playwright.config.ts`) spawns **two** servers and waits for both to be reachable before any test runs:

1. **Backend** — `cd ../api && uv run uvicorn myapp.entrypoints.api:app --port 8090`. Waits for `/health`. Required because the Expo bundle's `useEffect` calls `/items` on mount; without a backend the test would catch a `ERR_CONNECTION_REFUSED` and fail.
2. **Frontend** — `npx expo export --platform web && bunx serve dist -l 4321 -s`. Waits for the index page on `:4321`. Uses `npx` (not `bunx`) because Metro doesn't exit cleanly under bun.

`reuseExistingServer: !CI` lets local re-runs reuse a server you already have running (e.g. a `just api` in another terminal). In CI it always starts fresh.

### Available capabilities inside a test

- **`page.on("pageerror", handler)`** — captures uncaught JavaScript exceptions during render. Used by `smoke.spec.ts` as the primary assertion.
- **`page.on("console", handler)`** — captures console output. Filtering by `msg.type() === "error"` catches `console.error()` calls including React warnings about uncaught promise rejections.
- **`page.screenshot({ path: "..." })`** — write a PNG of the current viewport. Useful for visual regression in extended tests.
- **`page.locator("text=Loading...").waitFor({ state: "hidden" })`** — wait for specific UI states to settle.
- **`expect(page).toHaveTitle(/.../)`** — assert page title matches a regex.
- **`page.evaluate(() => { ... })`** — run arbitrary JavaScript in the page context. Use sparingly; usually a sign you should be testing something else.
- **`page.waitForLoadState("networkidle")`** — wait until network has been idle for 500ms. Used in the smoke test to ensure async hydration has settled before assertions.
- **`page.waitForRequest(/\/api\//)`** — wait for a specific HTTP call to fire. Useful when you want to test that a button triggers an API call.
- **Full Playwright API** — `click`, `fill`, `selectOption`, `keyboard.press`, `dragTo`, etc. See https://playwright.dev/docs/api/class-page

### Adding a new web test

Create a sibling file in `apps/mobile/tests/web/`:

```typescript
// apps/mobile/tests/web/items-flow.spec.ts
import { expect, test } from "@playwright/test";

test("user can add an item and see it in the list", async ({ page }) => {
  await page.goto("/");
  await page.locator("text=No items").waitFor();

  await page.locator("input[placeholder*='name']").fill("hello");
  await page.locator("button:has-text('Add')").click();

  await expect(page.locator("text=hello")).toBeVisible();
});
```

Keep web tests **focused on what only a real browser can verify**: rendering, runtime errors, CSS layout, real navigation, real user interaction. Logic that lives in `lib/*.ts` should be tested by `bun test` in `tests/unit/` instead — those run in 80ms vs 10+ seconds for Playwright.

### Limitations

- **Chromium only.** Firefox and WebKit aren't installed by default. Add them with `bunx playwright install firefox webkit` and uncomment the projects in `playwright.config.ts` if you need cross-browser coverage.
- **Headless by default.** UI mode (`--ui`) is the recommended interactive workflow.
- **No visual regression baseline.** Add `playwright-visual-regression-tracker` or use `expect(screenshot).toMatchSnapshot()` if you need it.
- **Cold start is ~15s** because of the bundle export + Chromium boot. The actual page-load + assertions are <2s. Most of the cost is one-time per `just verify` run, not per test.

### CI integration

The `test-web-local` job in `.github/workflows/e2e.yml` runs the same suite on push to `main` and nightly. It sets up both Python (uv) and Node (bun), installs Chromium with `bunx playwright install chromium --with-deps`, then runs `bunx playwright test`. ~30-60s in CI cold including Chromium download (cached on subsequent runs).

### Relationship to Playwright MCP

The web tier and Playwright MCP solve **different problems** and can coexist. See [`philosophy.md` § MCP vs test tier](philosophy.md#mcp-vs-test-tier-worked-example) for the full breakdown:

- **Test tier** (this section) — deterministic, CI-compatible, regression gate. Baked into `just verify`. The floor for runtime UI validation.
- **Playwright MCP** (opt-in) — agent-callable browser tools for in-session interactive debugging. Run `just enable-mcp-playwright` to whitelist. Doesn't replace the test tier.

When the web tier fails in CI, MCP is what the agent uses next session to investigate the live DOM and propose a fix. They're layered, not competing.

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

No factory libraries, no frozen time, no VCR, no hypothesis, no mutation testing, no contract tests, no visual regression baselines. See [`philosophy.md`](philosophy.md) for the baseline-vs-extension framing — the short version is "add when the skeleton has a concrete need, not before."
