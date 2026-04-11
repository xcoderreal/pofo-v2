# Experiment 01 — Persistence adapter

**Tests:** the "extend with persistence" story actually works — swapping `MemoryItemRepository` for a real SQL-backed adapter doesn't break the layering, and `FakeItemRepository` remains usable for tests.

**Status:** ⏳ Not yet run.

---

## The prompt (copy verbatim into a fresh Claude Code session)

```
Add SQLite-backed persistence to this skeleton, alongside the existing
in-memory storage. The choice between adapters should be configurable
without code changes.

Read CLAUDE.md and docs/architecture.md before touching anything —
they describe the layering, testing, conventions, and commands. If
something there is unclear, ask before inventing.

Definition of done:
  - I can pick which adapter is active via configuration
  - The new adapter has its own tests
  - All existing tests still pass against both adapters
  - `just verify` is green

As you work, maintain a progress log at LOG.md in the repo root
(do NOT commit it). Append one entry per significant action — reading
a doc, writing a file, running a recipe, hitting an error, making a
decision. Format:

  ## <n> — <one-line action>
  **Why:** <reason>
  **Outcome:** <result, including failures>

Keep LOG.md append-only.

Before reporting done, write a retrospective to RETRO.md at the repo
root (also not committed). Cover:

  1. Which files from CLAUDE.md and docs/ did you actually read, and
     when?
  2. Which `just` recipes did you run, in order? One-line reason each.
  3. Architectural decisions you made that weren't in the spec —
     anything you had to invent because the docs didn't cover it.
  4. Rules you noticed in CLAUDE.md but had to consciously work around
     or ignore, and why.
  5. Questions you wanted to ask but didn't — how did you decide?
  6. What would you add to CLAUDE.md or docs/ based on building this?

Be honest, including about places where you went back and fixed
something mid-course.

Do NOT start any dev server.

Go.
```

---

## What passing looks like (for the maintainer to use after the run)

### Hard gates (binary)

- `just verify` exits 0 with the default adapter
- `just verify` exits 0 with the SQL adapter selected
- `git diff main -- apps/api/src/myapp/domain/` is empty (domain didn't change)
- `git diff main -- apps/api/src/myapp/service/` is empty (service didn't change)
- A new `Sql*Repository` adapter file exists under `apps/api/src/myapp/adapters/`
- Switching adapters requires no code changes (env var or config only)

### Soft signals (judgment calls)

- The SQL adapter is small — under ~150 lines is healthy, over 300 is suspicious (probably reaching for an ORM unnecessarily)
- Schema creation lives in the adapter, not in a separate migration module
- The agent did NOT introduce a separate "entity" or "mapper" module — translation should be inline in the repository
- Per-milestone commits with sensible messages
- The smoke and e2e tiers ran against the SQL adapter at least once during the experiment
- The agent figured out the SQLite-vs-SQLAlchemy choice from CLAUDE.md's "no new dependencies for hypothetical needs" guidance (rather than reaching for SQLAlchemy by default)

### Skeleton-improvement signals — things to watch for in the RETRO

- **Settings field name** — whichever the agent picked (`repository_kind`, `storage`, `db_backend`...), is it discoverable from CLAUDE.md or did they have to invent it?
- **Schema creation timing** — at process start? On first request? In a `setup()` method? Reveals how the agent thinks about app lifecycle.
- **Connection lifecycle** — one connection per process? Per request? For SQLite "one per process" is fine, but did the agent leave a comment about it?
- **Test isolation for SQL unit tests** — `tmp_path` fixture or shared file? Tells us whether the test pyramid story scales to a real adapter.
- **The `get_repo()` factory pattern** — did the agent honor `@lru_cache`, or evolve it?

### Things that would justify a skeleton fix

If the agent had to fight the skeleton in any of these places, it's a real gap:

- "I couldn't extend Settings without modifying X file" → Settings should be more extensible
- "The repository ABC needed a new method I had to add" → either the ABC was incomplete OR the new method belongs in the service layer
- "I had to change entrypoints/api.py beyond `get_repo()`" → the wiring abstraction leaked
- "The test helper assumed memory" → conftest needs to parameterize over adapters

## Findings

### v1 — 2026-04-11

**Verify status:** ✅ green on both adapters
- `just verify` (memory) — all tiers pass: 13 unit + 15 integration + 4 smoke + 16 mobile-unit + 1 web + check
- Integration + smoke + e2e re-run with `MYAPP_REPOSITORY=sqlite MYAPP_DATABASE_PATH=...` — 31 tests pass

**Skeleton bugs surfaced:** none blocking. Hard gates all green; layering held; domain and service layers byte-identical to start state.

**What the agent built:**
- `apps/api/src/myapp/adapters/sqlite_repository.py` — 65 lines, stdlib `sqlite3` + `json`. No SQLAlchemy. Fresh connection per method call (FastAPI threadpool-aware).
- Two new `Settings` fields: `repository: str = "memory"` and `database_path: str = "data/items.db"`.
- `get_repo()` in `entrypoints/api.py` dispatches on `settings.repository`.
- `apps/api/tests/unit/adapters/test_sqlite_repository.py` — 8 tests using `tmp_path` for isolation.
- Schema creation via `CREATE TABLE IF NOT EXISTS` in the adapter constructor — no migrations infrastructure.

**Best signal:** the agent reached the right pattern from CLAUDE.md + architecture.md alone — chose stdlib over SQLAlchemy without prompting, used `tmp_path` for test isolation, kept the integration tier adapter-agnostic.

**Promotable patterns** (landed in skeleton post-v1):
- `data/` and `*.db` patterns in `.gitignore` — preemptive cleanup
- CLAUDE.md note: when extending `Settings`, also update `apps/api/.env.sample`
- `docs/architecture.md` § "Adding a new adapter" — expanded with the FastAPI threadpool / fresh-client-per-call pattern note
- `docs/testing.md` — new "Where adapter conformance lives" section codifying the unit-tier-plus-env-var-swap pattern the agent invented

**Deliberately not landed:**
- A worked "Adding a SQL adapter" example with code in `docs/architecture.md` — would remove the validation power of the v2 re-run by giving the next agent something to copy-paste rather than think through
- A `just verify-sqlite` recipe — the skeleton ships no SQL adapter, so there's nothing to verify against; doc-level guidance is sufficient

**Process notes:**
- Zero git commits during the experiment (worked with uncommitted changes throughout). Same pattern as v3 home-inventory. Two consecutive experiments without commit cadence — gray area, may revisit.
- LOG.md was 13 entries, linear, one self-caught format failure (`fmt-api-check`) followed by a clean re-run. Healthy.
- RETRO.md §6 listed 4 skeleton improvement candidates; 3 of them landed as the post-v1 doc updates. The 4th (worked example) was deliberately deferred.

**Status:** ✅ v1 passed cleanly; v2 re-run pending to validate the doc fixes are discoverable.

### v2 — pending

> **Run on:** _date_
> **Final commit:** _sha_
> **Delta from v1:** _did the agent reference the new architecture.md note? did the new testing.md callout get used? did the agent's RETRO §6 shrink?_
> **Status:** _⏳ pending_
