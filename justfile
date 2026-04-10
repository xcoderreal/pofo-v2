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

# ─── Backend app shortcuts ────────────────────────────────────
api:
    cd apps/api && uv run uvicorn myapp.entrypoints.api:app --reload --host 0.0.0.0 --port 8090
api-setup:
    cd apps/api && uv sync --all-extras

# ─── Scaffolding: fork this skeleton into a new project ──────
# Usage: just new-project my_app
#   - Renames Python package 'myapp' → 'my_app' everywhere
#   - Updates env prefix, Expo slug, bundle id, display name
#   - Does NOT touch README.md or docs/ (review by hand)
new-project slug:
    python3 scripts/init-project.py {{slug}}
