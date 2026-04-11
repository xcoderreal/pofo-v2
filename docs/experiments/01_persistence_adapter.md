# Experiment 01 — Persistence adapter

**Tests:** the "extend with persistence" story actually works — swapping `MemoryItemRepository` for a real SQL-backed adapter is one-line wiring, the Cosmic Python layering survives a real database, and `FakeItemRepository` remains usable for tests.

**Status:** ⏳ Not yet run.

---

## The full prompt (copy verbatim into a fresh Claude Code session)

```
Add a SQLite-backed persistence adapter to this skeleton, alongside
the existing MemoryItemRepository. The two adapters should be
interchangeable via a single env var, and ALL existing tests must
continue to pass against both adapters.

CLAUDE.md has the layering rules, testing conventions, file-path
conventions, commands, and "adding a resource" ordering. Follow it —
I'm not restating it here. If something in CLAUDE.md is unclear, stop
and ask before inventing a convention.

What you need to build:
  - A SqlItemRepository in apps/api/src/myapp/adapters/sql_repository.py
    that implements ItemRepository (the existing ABC). It should
    persist to a SQLite file by default — path configurable via the
    pydantic-settings layer (Settings.sqlite_path or similar).
  - The translation between Item (domain dataclass) and the SQL row
    happens INSIDE the repository — it's the one place that knows
    about the table schema. Do not introduce a separate "entity" or
    "mapper" module unless you have a compelling reason.
  - A way to choose which adapter is active at process start. Most
    natural: a Settings field like `repository: Literal["memory", "sql"]`
    defaulting to "memory". The `get_repo()` factory in entrypoints/api.py
    reads it and returns the right adapter.
  - Schema creation: simplest possible — at startup, the SQL adapter
    runs `CREATE TABLE IF NOT EXISTS items (...)`. No Alembic, no
    migrations infrastructure. If you need to evolve the schema later,
    that's a separate experiment.

Test discipline:
  - Existing unit tests (tests/unit/service/test_item_service.py) MUST
    continue to pass unchanged — they use FakeItemRepository, which
    has nothing to do with the SQL adapter.
  - Existing integration tests (tests/integration/test_api.py) MUST
    continue to pass unchanged — they use FakeItemRepository via
    dependency_overrides.
  - NEW unit tests in tests/unit/adapters/test_sql_repository.py that
    exercise SqlItemRepository directly against a temporary SQLite file
    (tmp_path fixture). These tests should cover: empty list, add +
    list, get by id, get nonexistent, add_many, persistence across
    repository instances pointing at the same file.
  - The smoke and e2e tiers should ALSO be runnable against the SQL
    adapter, not just memory. Demonstrate this by running them once
    with the SQL adapter active (set the env var, run the recipe).

Scope:
  - SQLite only. No Postgres, no Supabase. SQLite proves the pattern
    in 200 lines without bringing in a real database server.
  - No connection pooling, no async, no migrations. The SQL adapter
    can use sqlite3 from the stdlib — no SQLAlchemy unless you have
    a clear reason. Keep dependencies minimal.
  - Single table for items. No foreign keys, no joins.
  - In-process — the SQL adapter holds a connection or opens one per
    request, your call.

Rules of engagement (beyond CLAUDE.md):
  - The domain layer (apps/api/src/myapp/domain/) must NOT change.
    No new imports, no new fields. If you find yourself wanting to
    change Item itself, stop — the experiment is testing whether the
    layering holds, not whether the domain is right.
  - The service layer (apps/api/src/myapp/service/) must NOT change.
    Service depends on the ItemRepository interface, not on any
    concrete adapter. If the service has to know about SQL, the
    abstraction has leaked.
  - get_repo() in entrypoints/api.py CAN change — it's allowed to
    branch on the new Settings field. That's the one acceptable
    coupling between "user picks adapter" and "the repository wiring."
  - No new top-level dependencies unless absolutely needed. sqlite3 is
    in the Python stdlib. If you reach for SQLAlchemy, justify it in
    the RETRO.

Suggested milestones (one commit each):
  1. SqlItemRepository skeleton (class + ABC compliance, raises
     NotImplementedError everywhere) + the test file with all the
     test cases marked xfail
  2. Implement list_all + get + the corresponding tests
  3. Implement add + add_many + the corresponding tests
  4. Wire Settings.repository_kind + get_repo() factory branching
  5. Add a small docs/adapters.md (NEW) showing how the swap works
  6. Run the smoke + e2e tiers with REPOSITORY_KIND=sql to prove they
     work against both adapters

Definition of done:
  - just verify is green (all five tiers pass against the default
    memory adapter)
  - Same just verify is green when REPOSITORY_KIND=sql is set
    (only the api startup behavior changes; tests still use
    FakeRepository for the unit/integration tiers, and the new
    SQL unit tests run against tmp_path SQLite)
  - The smoke + e2e tiers, with REPOSITORY_KIND=sql, demonstrate
    the round-trip works against a real SQL backend
  - docs/adapters.md exists and explains the pattern with a code
    snippet
  - The domain and service layers have ZERO changes (verify with
    git diff apps/api/src/myapp/{domain,service}/ — should be empty)
  - The agent can swap from memory to SQL by setting one env var
    and restarting the server (no code changes)

Before reporting done, write a retrospective to RETRO.md at the repo
root (do NOT commit it — leave it untracked). Cover:

  1. Which files from CLAUDE.md and docs/ did you actually read, and
     when? (At the start? When you hit a decision? Never?)
  2. Which `just` recipes did you run, in order? One-line reason each.
  3. Architectural decisions you made that weren't explicitly in the
     spec — where you placed methods, how you modeled entities,
     anything you had to invent because the docs didn't cover it.
  4. Rules you noticed in CLAUDE.md but had to consciously work around
     or ignore, and why.
  5. Questions you wanted to ask but didn't — how did you decide
     instead?
  6. What would you add to CLAUDE.md or docs/ based on building this?
     Rules that were unclear, things you had to guess, patterns worth
     codifying.

Also maintain LOG.md as you work — append-only, one entry per
significant action. Format:

  ## <n> — <one-line action>
  **Why:** <reason>
  **Outcome:** <result, including failures>

Keep LOG.md append-only. Never rewrite previous entries. The log is
ground truth for what happened in what order.

Do NOT start `expo start` or any dev server — I'll test the UI manually
after you report done. You can run `bunx expo export --platform web` to
verify the bundle compiles.

Go.
```

## What "passing" looks like (success criteria for the maintainer)

After the agent reports done, the maintainer should verify:

### Hard gates (binary)

- `just verify` exits 0 with the default memory adapter
- `REPOSITORY_KIND=sql just verify` exits 0 with the SQL adapter
  (or whichever recipe / env var the agent picked)
- `git diff main -- apps/api/src/myapp/domain/` is empty (domain didn't change)
- `git diff main -- apps/api/src/myapp/service/` is empty (service didn't change)
- A new file exists at roughly `apps/api/src/myapp/adapters/sql_repository.py`
- A new test file exists at roughly `apps/api/tests/unit/adapters/test_sql_repository.py`
- The new SQL unit tests use `tmp_path` (or equivalent) for isolation
- Switching adapters is a single env var change

### Soft signals (judgment calls)

- The SQL adapter is small — under 150 lines is healthy, over 300 lines is suspicious (probably reaching for an ORM unnecessarily)
- The schema creation logic is in the adapter, not in a separate migration system
- The adapter uses `sqlite3` from the stdlib (preferred) or one minimal extra dep (acceptable)
- The agent did NOT introduce a separate "entity" or "mapper" module — translation should be inline in the repository
- The smoke/e2e tests run against the SQL adapter without modification
- Per-milestone commits with sensible messages (6-8 commits expected)

### Skeleton-improvement signals (what to look for)

The interesting findings come from how the agent navigated genuine ambiguity:

- **Settings field name** — `repository_kind`? `storage`? `db_backend`? Whichever the agent picked, is it discoverable from CLAUDE.md or did they have to invent it?
- **Schema creation timing** — at process start? On first request? In a `setup()` method? Any of these is defensible; the choice reveals how the agent thinks about app lifecycle.
- **Connection lifecycle** — one connection per process? Per request? Pooled? For SQLite, "one per process" is fine; for "real" databases this would be a problem. Did the agent leave a comment about that?
- **Test isolation** — the SQL unit tests need their own temp file per test. Did the agent use `tmp_path`? Or fall into a "shared file across tests" trap?
- **The `get_repo()` pattern** — did the agent keep it as a factory function, or refactor it into something more elaborate? CLAUDE.md says factory + `@lru_cache`; did the agent honor that or evolve it?

### Things that would justify promoting to baseline

If the agent's solution to any of the soft signals is consistent and elegant, that's a candidate for the next CLAUDE.md edit:

- A clean adapter swap pattern → document in `docs/architecture.md` or a new `docs/adapters.md`
- A useful test fixture for SQL adapters → mention in `docs/testing.md`
- A specific gotcha (e.g., "SQLite needs `check_same_thread=False` with FastAPI's threadpool") → add to `docs/architecture.md` § Persistence

### Things that would justify a skeleton fix

If the agent had to fight the skeleton in any of these places, it's a real gap to fix:

- "I couldn't extend Settings without modifying X file" → Settings should be more extensible
- "The repository ABC needed a new method I had to add" → either the ABC was incomplete OR the new method belongs in the service layer
- "I had to change entrypoints/api.py beyond `get_repo()`" → the wiring abstraction leaked
- "The test helper assumed memory" → conftest needs to parameterize over adapters

## Findings (to be filled in after the run)

> **Run on:** _date_  
> **Agent:** _Claude version_  
> **Final commit:** _sha_  
> **Verify status:** _green / red / partial_  
> **Skeleton bugs surfaced:** _list_  
> **Promotable patterns:** _list_  
> **Status:** _⏳ / 🟡 / ✅ / 🟠 / ❌_
