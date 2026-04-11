# turbo-skeleton: design philosophy

This skeleton is an **opinionated, AI-friendly, end-to-end stack scaffolding** for building cross-platform apps (web + iOS) with a Python backend. It bakes in architecture choices, test conventions, and developer workflows that make agent-driven development reliable — and leaves everything else as opt-in extensions.

This doc explains what the skeleton is, what it isn't, and the principle behind which things are baseline vs optional.

## What the skeleton IS

A tight, ready-to-run scaffolding with:

- **Turborepo + Bun workspace** — monorepo task orchestration without imposing structure
- **FastAPI backend** with [Cosmic Python DI layering](architecture.md) — pure domain, abstract repository, service layer, thin entrypoints
- **Expo SDK 54 frontend** with expo-router, pinned to known-good versions (see [pinned-versions.md](pinned-versions.md))
- **Four-tier test pyramid** — unit, integration, smoke, e2e (see [testing.md](testing.md))
- **Memory-first repository pattern** — `MemoryItemRepository` is the default. Sufficient for prototyping, and a legitimate production choice for caches, demos, and services where state is recomputed.
- **Agent-readable documentation** — `CLAUDE.md` + `docs/` that Claude Code auto-loads and follows
- **`just` recipes** for every common operation: install, verify, dev, test by tier, build, clean, kill

The goal: `git clone` → `just new-project my_app` → `claude` → describe what you want to build → ship.

## What the skeleton is NOT

- **Not a framework.** FastAPI and Expo are used as-is; nothing wraps them.
- **Not a persistence layer.** Memory is the reference implementation; SQL/Supabase/Redis are extensions.
- **Not an auth system.** No sessions, no tokens, no user model. Add when you need it.
- **Not a UI component library.** Expo StyleSheet is all you get. No theming, no design system, no component kit.
- **Not a BaaS client.** Nothing presumes Supabase, Firebase, or any vendor.
- **Not a test runner for every scenario.** The five tiers cover unit → integration → smoke → e2e → web. Specialized testing (visual regression, contract testing, chaos, load) is opt-in.

Every "not" is deliberate. Adding any of them to the baseline locks every fork into a choice it didn't ask for.

## The opinionated baseline (baked in, non-negotiable)

These ARE the skeleton:

| Baseline | Why it's baked in | Details |
|---|---|---|
| Cosmic Python layering | Pure domain + abstract repository is the architecture. Violating it breaks the pattern. | [architecture.md](architecture.md) |
| Four-tier test pyramid | Each tier answers a different question. Without them you can't tell where a bug is. | [testing.md](testing.md) |
| `FakeRepository` testing (no mocks) | Mocks hide interface drift. Fake adapters catch it. | `CLAUDE.md` Testing philosophy |
| Mirror convention for unit tests | `tests/unit/<layer>/test_*.py` maps to `src/*/<layer>/*.py`. Scales. | `CLAUDE.md` Test file locations |
| `just verify` as the local gate | One deterministic command equivalent to CI | `CLAUDE.md` Commands |
| Pinned Expo SDK versions | RN + Expo is a minefield. Getting versions wrong wastes days. | [pinned-versions.md](pinned-versions.md) |
| `git new-project` chained setup | Rename → install → lint-fix → verify in one command | [bootstrap.md](bootstrap.md) |

These don't change per fork. If you want to fight the baseline, fork a different skeleton.

## Optional extensions (the opt-in layer)

These are deliberately NOT in the baseline:

### Persistence adapters

- **Memory** (default, included) — `MemoryItemRepository`
- **SQLite / Postgres** (opt-in) — implement the repository ABC in `adapters/sql_repository.py`, swap `get_repo()`. No SQL dep in the skeleton by default.
- **Supabase** (opt-in) — `SupabaseItemRepository` using `supabase-py` (the Python client). Provides environment switching (local / staging / prod) via env vars. `FakeRepository` stays usable for tests regardless.
- **Redis / DynamoDB / anything else** — same pattern: implement the ABC, swap the wiring.

The `ItemRepository` ABC is storage-agnostic by design. Adding real persistence is ONE file change. See [architecture.md § repository abstraction](architecture.md).

### Runtime UI testing

- **Test tier** (`@playwright/test` in `tests/web/`) — persistent, deterministic, CI-compatible. The regression gate.
- **MCP** (`@playwright/mcp` as a Claude Code MCP server) — interactive, agent-callable browser automation for in-session debugging. Not in CI.

See the [MCP vs test tier](#mcp-vs-test-tier-worked-example) section below for when each fits.

### Auth / multi-user

Not built in. Add a middleware + user model + session layer when you have a real auth requirement. Attempting a general auth scaffolding without a specific use case produces unused code.

### Background jobs / queues / caches / pub-sub / domain events

Not built in. Add when you have a concrete subscriber or workload.

## The extension philosophy

When deciding whether something belongs in the baseline or as an opt-in extension, ask:

1. **Does every fork need this?** If yes → baseline. If "most" → probably opt-in.
2. **Does adding it lock us into a vendor?** If yes → opt-in, document the alternative.
3. **Does it change the mental model of the skeleton?** If yes → needs its own `docs/` section, and probably deserves a deliberate baseline decision.
4. **Does it add a dependency that's painful to remove?** If yes → opt-in, default off.

**Rule of thumb:** ship the minimum that serves the 80% case; document the path to everything else. Going from opt-in to baseline is easy; going the other direction — removing a baseline that forks depend on — is very hard.

## MCP vs test tier: worked example

This is the canonical example of the baseline-vs-extension distinction, and a common confusion worth naming.

**Playwright as a test tier** (`@playwright/test` in `tests/web/`):

- Deterministic, CI-compatible, shell-invokable
- Part of `just verify` — catches regressions automatically
- Runs headless in CI, errors cause the gate to fail
- **Baseline** for runtime UI validation

**Playwright as MCP** (`@playwright/mcp` as a Claude Code MCP server):

- Agent-interactive browser tools (`browser_navigate`, `browser_snapshot`, `browser_console_messages`, etc.)
- Only works inside a Claude Code session — no shell access, no CI runner
- Tighter feedback loop than writing tests and running them
- **Opt-in extension** for in-session debugging

They don't compete; they solve different problems:

| Need | Tool |
|---|---|
| **Regression gate** — the next push can't introduce runtime UI errors | Test tier (baked into `just verify`) |
| **Interactive debug** — when a test fails, let the agent investigate the live DOM | MCP (opt-in) |
| **CI/CD gating** — block PRs on deterministic checks | Test tier only (MCP doesn't run in CI) |
| **Agent quality** — let Claude proactively verify UI before declaring done | Either, but MCP is smoother |

**"MCP is the future" is correct, but narrow.** MCP is the future for *in-session agent validation* — it's a tighter loop than writing tests to probe the UI. For the agent's experience, it's strictly better than running shell tests.

But "agent experience is better with MCP" is not the same as "CI can use MCP." The CI world is about **deterministic invariants on commits**, and that world will stay test-based for a long time. Maybe forever. Running LLMs in CI to call MCP tools is slow, expensive, non-deterministic, and depends on Anthropic API uptime — none of which CI gates tolerate.

They're fundamentally different shapes:

- **Tests** verify invariants deterministically. They're cheap and fast and the same every run.
- **MCP** gives an agent a way to investigate interactively. It's smart but not repeatable.

Both matter. The skeleton bakes in the test tier as baseline and provides the MCP enabler as opt-in.

## How to extend, practically

When you want to add a capability:

1. **Check if it belongs in the baseline** using the four questions above. Most things don't.
2. **If opt-in:** add the code behind a `just` recipe or a script, document in `docs/`, and don't force it on forks that don't want it. Make it easy to enable, but silent if not enabled.
3. **If baseline:** add to `CLAUDE.md` (the agent contract), update `docs/architecture.md` or `docs/testing.md` as appropriate. Every fork now gets it.
4. **When in doubt:** opt-in first. Promote to baseline later if the pattern holds across multiple experiments.

## Why this framing matters

Without this doc, every extension request re-litigates the same argument: "should we add X to the skeleton?" Answers drift by mood and by how much the requester cares. Having this framing turns the question into "is X baseline or extension?" — which is answerable by the four questions above without re-running the entire debate.

This is also why the skeleton has a [maintainer's feedback loop](../MAINTAINING.md) (not linked from CLAUDE.md because it's maintainer-only) — the loop surfaces what *should* be baseline based on actual usage, rather than speculation.

## See also

- [`architecture.md`](architecture.md) — Cosmic Python layering rationale
- [`testing.md`](testing.md) — the five-tier test pyramid (unit → integration → smoke → e2e → web)
- [`bootstrap.md`](bootstrap.md) — install + worktree troubleshooting
- [`vercel.md`](vercel.md) — deploy flow
- [`pinned-versions.md`](pinned-versions.md) — Expo SDK version pins
- [`CLAUDE.md`](../CLAUDE.md) — the agent contract
