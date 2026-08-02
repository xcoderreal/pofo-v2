# Turbo Skeleton

# ─── Dev servers ──────────────────────────────────────────────
dev: dev-web
dev-web:
    bunx turbo dev:web --ui tui
dev-ios:
    bunx turbo dev:ios --ui tui

# ─── Install / setup ──────────────────────────────────────────
install:
    bun install && cd apps/api && uv sync --all-extras

# ─── Tests (repo-wide + per-app) ──────────────────────────────
# `just test` runs everything a CI job would run.
test: test-api test-mobile
test-api:
    cd apps/api && uv run pytest
test-unit:
    cd apps/api && uv run pytest tests/unit/
test-integration:
    cd apps/api && uv run pytest tests/integration/
# `test-smoke-local` spawns its own uvicorn via the conftest fixture.
test-smoke-local:
    cd apps/api && uv run pytest tests/smoke/ -v
# `test-smoke url=...` runs smoke against an externally-managed URL.
# Example: just test-smoke url=http://127.0.0.1:8090
#          just test-smoke url=https://staging.example.com
test-smoke url:
    cd apps/api && SKELETON_E2E_URL={{url}} uv run pytest tests/smoke/ -v
# `test-e2e-local` spawns its own uvicorn via the conftest fixture.
test-e2e-local:
    cd apps/api && uv run pytest tests/e2e/ -v
# `test-e2e url=...` runs e2e against an externally-managed URL.
# Writes are disabled unless url is localhost or SKELETON_E2E_ALLOW_WRITES=1.
test-e2e url:
    cd apps/api && SKELETON_E2E_URL={{url}} uv run pytest tests/e2e/ -v
test-mobile: test-mobile-typecheck test-mobile-unit
# Frontend typecheck (tsc --noEmit)
test-mobile-typecheck:
    cd apps/mobile && bunx tsc --noEmit
# Frontend unit tests (bun test, pure-function coverage of lib/)
test-mobile-unit:
    cd apps/mobile && bun test tests/unit/
# `test-web-local` = the web tier of the test pyramid. Exports the Expo
# web bundle, serves it statically, loads it in headless Chromium, and
# asserts the page renders without runtime errors. Catches CSS/runtime
# crashes that tsc and bundle-build miss. ~20s cold.
test-web-local:
    cd apps/mobile && bunx playwright test

# `test-rls` = the RLS enforcement proof tier (docs/security.md). Talks
# to PostgREST directly against a dedicated *test* Supabase project with
# two real fixture users' JWTs — the only seam that can prove an RLS
# policy actually works, since the app's stub-auth path bypasses RLS via
# the service-role key. Requires MYAPP_SUPABASE_TEST_URL/ANON_KEY/
# SERVICE_KEY; skips cleanly when absent, so it's NOT part of `just
# verify` — opt in explicitly once a test project is provisioned.
test-rls:
    cd apps/api && uv run pytest tests/rls/ -v

# ─── Formatting & linting (repo-wide + per-app) ───────────────
# `just check` = read-only (CI); `just fmt` = write (local).
check: lint fmt-check
fmt: fmt-api fmt-mobile
lint: lint-api lint-mobile
fmt-check: fmt-api-check fmt-mobile-check

fmt-api:
    cd apps/api && uv run ruff format src/ tests/
fmt-api-check:
    cd apps/api && uv run ruff format --check src/ tests/
lint-api:
    cd apps/api && uv run ruff check src/ tests/
lint-api-fix:
    cd apps/api && uv run ruff check --fix src/ tests/

fmt-mobile:
    cd apps/mobile && bunx expo lint --fix
fmt-mobile-check:
    cd apps/mobile && bunx expo lint
lint-mobile:
    cd apps/mobile && bunx expo lint

# ─── API → Frontend contract ──────────────────────────────────
# Generate TS types from the FastAPI OpenAPI schema. Committed output:
#   apps/mobile/lib/api-schema.json  (raw OpenAPI JSON)
#   apps/mobile/lib/api-types.ts     (generated TS interfaces)
# `lib/api.ts` imports from `api-types.ts` — no manual interface definitions.
gen-api-types:
    cd apps/api && uv run python -c "import json; from myapp.entrypoints.api import app; print(json.dumps(app.openapi(), indent=2))" > ../mobile/lib/api-schema.json
    cd apps/mobile && bunx openapi-typescript lib/api-schema.json -o lib/api-types.ts
# Verify committed types match what the backend would generate.
check-api-types: gen-api-types
    git diff --exit-code apps/mobile/lib/api-schema.json apps/mobile/lib/api-types.ts

# ─── Full health check ───────────────────────────────────────
# `just verify` = pre-commit / PR gate.
# Runs unit + integration + smoke-local + web (real browser runtime) +
# api-types contract check + check.
# Does NOT run backend e2e (use `just test-e2e-local` for that) or mobile
# typecheck (use `just test` for the full CI-equivalent run).
# ~35-45s cold because of Playwright's browser startup + bundle export.
verify: test-unit test-integration test-smoke-local test-mobile-typecheck test-mobile-unit test-web-local check-api-types check

# ─── Build artifacts ─────────────────────────────────────────
# `just build-web` = produce the static web bundle (matches Vercel's build).
# Uses `npx` (not `bunx`) because Metro doesn't exit cleanly under bun.
build-web:
    cd apps/mobile && npx expo export --platform web

# `just clean` = wipe build output and Metro caches (project + $TMPDIR).
# Safe: doesn't touch source, node_modules, or venvs. If you see stale
# content after cleaning, orphan Metro is probably regenerating caches —
# run `just kill` first.
clean:
    rm -rf apps/mobile/dist apps/mobile/.expo apps/mobile/node_modules/.cache .turbo
    rm -rf "${TMPDIR:-/tmp}"/metro-* "${TMPDIR:-/tmp}"/haste-map-* 2>/dev/null || true
    @echo "cleaned"

# `just dev-web-clean` = start web dev server with Metro cache cleared.
# Use when `just dev` shows stale content that doesn't match your source.
dev-web-clean:
    cd apps/mobile && bunx expo start --web --port 8091 --host lan --clear

# ─── Backend app shortcuts ────────────────────────────────────
api:
    cd apps/api && uv run uvicorn myapp.entrypoints.api:app --reload --host 0.0.0.0 --port ${MYAPP_PORT:-8090}
api-setup:
    cd apps/api && uv sync --all-extras

# `just kill` = stop any running dev servers (backend + frontend web).
# Run this when ports are stuck ("Address already in use"), or when
# orphan Metro is regenerating stale caches.
kill:
    -lsof -i :${MYAPP_PORT:-8090} -t 2>/dev/null | xargs kill 2>/dev/null
    -lsof -i :8091 -t 2>/dev/null | xargs kill 2>/dev/null
    @echo "killed dev servers (backend ${MYAPP_PORT:-8090}, web 8091)"

# `just enable-mcp-playwright` = whitelist the Playwright MCP server's
# browser tools in .claude/settings.json. Idempotent — safe to re-run.
# Requires @playwright/mcp to be installed in your Claude Code environment
# (separate from this repo's dependencies). See docs/testing.md for context
# on when MCP is useful vs the test tier.
enable-mcp-playwright:
    python3 scripts/enable-playwright-mcp.py

# ─── Scaffolding: fork this skeleton into a new project ──────
# `just new-project <slug>` = rename placeholder + install + lint-fix + verify.
# Single command for forking. The python script is the primitive (plain text
# substitution, glob-discovered files); this recipe chains the steps you'd
# always want to run afterward.
#
# For rename-only (no install or verify), call the script directly:
#   python3 scripts/init-project.py <slug>
#
# Usage: just new-project my_app
#   - Renames 'myapp' → 'my_app' across src + tests + configs + Expo app
#   - Updates env prefix (MY_APP_), Expo slug, bundle id, display name ("My App")
#   - Runs bun install + uv sync
#   - Runs ruff --fix to normalize import order after the rename
#   - Runs `just verify` as a baseline check
#   - Does NOT touch README.md or docs/ (review by hand after)
new-project slug:
    python3 scripts/init-project.py {{slug}}
    bun install
    cd apps/api && uv sync --all-extras
    cd apps/api && uv run ruff check --fix src/ tests/
    @echo ""
    @echo "─── running baseline verification ──────────────────────"
    just verify
    @echo ""
    @echo "✓ Fork complete. Launch Claude Code when ready: claude"
