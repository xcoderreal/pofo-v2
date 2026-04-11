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

## Findings (fill in after the run)

> **Run on:** _date_  
> **Agent:** _Claude version_  
> **Final commit:** _sha_  
> **Verify status:** _green / red / partial_  
> **Skeleton bugs surfaced:** _list_  
> **Promotable patterns:** _list_  
> **Status:** _⏳ / 🟡 / ✅ / 🟠 / ❌_
