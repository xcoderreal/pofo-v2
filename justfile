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
# `just verify` = test + check + live API smoke test end-to-end.
# Optional positional port arg falls back to $MYAPP_PORT then 8090:
#   just verify           # default port
#   just verify 9191      # custom port
#   MYAPP_PORT=9191 just verify   # also works
verify port=env_var_or_default("MYAPP_PORT", "8090"): test check
    just smoke {{port}}

smoke port=env_var_or_default("MYAPP_PORT", "8090"):
    #!/usr/bin/env bash
    set -euo pipefail
    PORT={{port}}
    echo "==> smoke: using port $PORT"
    lsof -i :$PORT -t | xargs kill 2>/dev/null || true
    cd apps/api
    uv run uvicorn myapp.entrypoints.api:app --host 127.0.0.1 --port $PORT &
    PID=$!
    trap 'kill $PID 2>/dev/null || true; wait $PID 2>/dev/null || true' EXIT
    sleep 1.5
    BASE="http://127.0.0.1:$PORT"
    echo "==> GET /health"
    curl -fsS "$BASE/health" | grep -q '"status":"ok"'
    echo "==> POST /items"
    curl -fsS -X POST "$BASE/items" \
        -H 'content-type: application/json' \
        -d '{"id":"smoke","name":"smoke","description":"","tags":["t1"]}' \
        -o /dev/null -w '%{http_code}\n' | grep -q '^201$'
    echo "==> GET /items"
    curl -fsS "$BASE/items" | grep -q '"id":"smoke"'
    echo "==> GET /items/smoke"
    curl -fsS "$BASE/items/smoke" | grep -q '"id":"smoke"'
    echo "==> GET /items?tag=t1"
    curl -fsS "$BASE/items?tag=t1" | grep -q '"id":"smoke"'
    echo "smoke test passed"

# ─── Build artifacts ─────────────────────────────────────────
# `just build-web` = produce the static web bundle (matches Vercel's build).
# Uses `npx` (not `bunx`) because Metro doesn't exit cleanly under bun.
build-web:
    cd apps/mobile && npx expo export --platform web

# `just clean` = wipe build output and Metro cache. Safe — doesn't touch
# source or node_modules themselves. Run this when you suspect a stale
# bundle (e.g. UI renders old content after a source edit).
clean:
    rm -rf apps/mobile/dist apps/mobile/.expo apps/mobile/node_modules/.cache .turbo
    @echo "cleaned: dist, .expo, metro cache, .turbo"

# `just dev-web-clean` = start web dev server with Metro cache cleared.
# Use when `just dev` shows stale content that doesn't match your source.
dev-web-clean:
    cd apps/mobile && bunx expo start --web --port 8091 --host lan --clear

# ─── Backend app shortcuts ────────────────────────────────────
api:
    cd apps/api && uv run uvicorn myapp.entrypoints.api:app --reload --host 0.0.0.0 --port ${MYAPP_PORT:-8090}
api-setup:
    cd apps/api && uv sync --all-extras

# ─── Scaffolding: fork this skeleton into a new project ──────
# Usage: just new-project my_app
#   - Renames Python package 'myapp' → 'my_app' everywhere
#   - Updates env prefix, Expo slug, bundle id, display name
#   - Does NOT touch README.md or docs/ (review by hand)
new-project slug:
    python3 scripts/init-project.py {{slug}}
