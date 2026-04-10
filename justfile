# Turbo Skeleton

# Dev (API + frontend in one tab)
dev: dev-web
dev-web:
    bunx turbo dev:web --ui tui
dev-ios:
    bunx turbo dev:ios --ui tui

# Backend
api:
    cd apps/api && uv run uvicorn myapp.entrypoints.api:app --reload --host 0.0.0.0 --port 8090
api-test:
    cd apps/api && uv run pytest
api-lint:
    cd apps/api && uv run ruff check src/ tests/
api-format:
    cd apps/api && uv run ruff format src/ tests/
api-setup:
    cd apps/api && uv sync --all-extras

# Monorepo
install:
    bun install && cd apps/api && uv sync --all-extras
