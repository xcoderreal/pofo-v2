# Bootstrap

Getting the workspace into a state where verification commands can run.

## The one-command setup

```bash
just install
```

Runs `bun install` (frontend + workspace deps) and `uv sync --all-extras` (backend venv) in sequence. Idempotent — safe to re-run any time.

Run it after:

- Cloning the repo
- `git worktree add`-ing a new working directory
- Switching branches if `package.json`, `bun.lock`, `pyproject.toml`, or `uv.lock` changed
- Pulling dep changes from another contributor

## Why `git worktree add` needs a fresh install

`git worktree` creates a new working directory that shares the same `.git/` but NOT `node_modules/` or `apps/api/.venv/`. From the dependency-installation perspective, a fresh worktree is equivalent to a fresh clone. **Always run `just install` inside a new worktree before any verification commands.**

This matters for remote agents, CI with persistent checkouts, and any tooling that uses `git worktree add` to isolate work — they all need the install step inside the new tree.

## Symptoms that mean "run just install"

| Symptom | What's missing | Fix |
|---|---|---|
| `Cannot find module 'eslint'` (from `bunx expo lint`) | `node_modules/` | `just install` |
| `ModuleNotFoundError: No module named 'fastapi'` / `httpx` / `pytest` / `uvicorn` | `apps/api/.venv/` not synced | `just install` |
| `just verify` errors before any test actually runs | Probably one of the above | `just install` first |
| Tests pass in the main checkout but fail in a fresh worktree with missing-module errors | Worktree doesn't inherit deps | `just install` inside the worktree |
| `uv: command not found` | UV not on PATH | Install UV: `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| `bun: command not found` | Bun not on PATH | Install Bun: `curl -fsSL https://bun.sh/install \| bash` |

## When `just install` isn't enough

Rare, but worth knowing:

- **Python version mismatch.** If Python was upgraded since the last install: `rm -rf apps/api/.venv && just install`.
- **Node version drift.** If `bun install` succeeds but `bunx expo lint` crashes with weird errors, check `node --version` — Node 22.x is required (see [`vercel.md`](vercel.md)). Node 24.x breaks some Expo/Metro plugins.
- **Stale lockfile after a merge.** If `bun.lock` or `uv.lock` is corrupt post-merge: delete it and reinstall (`rm bun.lock && bun install` or `rm apps/api/uv.lock && just install`).
- **Metro transform cache.** Orthogonal to bootstrap — see the "stale Metro bundles" section in [`../CLAUDE.md`](../CLAUDE.md) and [`just clean`](../justfile).

## If `just install` itself fails

- **Network timeouts during `bun install`** — first-run installs are large (~1700 packages for Expo SDK 54). Retry with `bun install --verbose` to see which package is stalling. A second attempt usually resolves transient network flakes.
- **UV sync fails on a dependency resolution error** — verify your Python version: `python3 --version` should be 3.12 or later. UV respects `requires-python` in `apps/api/pyproject.toml`.
- **`just: command not found`** — install `just` itself: `brew install just` on macOS, or see https://just.systems for other platforms.
