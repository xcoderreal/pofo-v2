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
test-mobile:
    cd apps/mobile && bunx tsc --noEmit

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

# ─── Full health check ───────────────────────────────────────
# `just verify` = fast pre-commit / PR gate.
# Runs unit + integration + smoke-local + check. Does NOT run e2e (use
# `just test-e2e-local` for that) or mobile typecheck (use `just test` for
# the full CI-equivalent run).
verify: test-unit test-integration test-smoke-local check

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

# ─── Scaffolding: fork this skeleton into a new project ──────
# Usage: just new-project my_app
#   - Renames Python package 'myapp' → 'my_app' everywhere
#   - Updates env prefix, Expo slug, bundle id, display name
#   - Does NOT touch README.md or docs/ (review by hand)
new-project slug:
    python3 scripts/init-project.py {{slug}}
