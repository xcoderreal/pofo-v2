# Experiment 02 — Auth middleware

**Tests:** the layering accommodates a cross-cutting concern (request-scoped user context, permission checks) without leaking auth into the domain or service layer.

**Status:** ⏳ Not yet run.

---

## The prompt (copy verbatim into a fresh Claude Code session)

```
Add JWT authentication to this skeleton. Users sign up, log in, and
only see their own items. Looking up another user's item by id should
return 404 (don't leak existence).

Read CLAUDE.md and docs/architecture.md before touching anything —
they describe the layering, testing, conventions, and commands. If
something there is unclear, ask before inventing.

Definition of done:
  - I can sign up via the frontend, log in, and see only my own items
  - A different user signed up sees their own empty list, not mine
  - Looking up someone else's item returns 404
  - The /me endpoint returns the current user
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

- `just verify` exits 0 with all new auth test files included
- `git diff main -- apps/api/src/myapp/domain/` shows ONLY plain dataclass additions (`User`, `user_id` field on `Item`) — no Pydantic, no PyJWT, no passlib imports in domain
- `git diff main -- apps/api/src/myapp/service/` shows the new auth service and user-scoping in `ItemService` — no JWT decoding, no FastAPI imports
- 401 returned for unauthenticated requests; 404 returned when accessing another user's item
- Password hash is NEVER returned in any response

### Soft signals (judgment calls)

- The "current user" injection uses FastAPI `Depends()`, returning a domain `User` object (not a Pydantic model or dict)
- The service layer methods take `user` as a parameter, not as thread-local or context var
- JWT verification errors translated to 401, not 500
- The frontend auth context is small (~30 lines), one Context + one provider + one hook
- Token storage is sensible (`expo-secure-store` on native, in-memory or storage on web)
- The agent reached for bcrypt or argon2 (well-known) rather than rolling crypto

### Skeleton-improvement signals — things to watch for in the RETRO

- **Where did `auth/` end up?** Sibling to domain/service/adapters/entrypoints, or inside one of them? CLAUDE.md doesn't currently say. The agent's choice is a candidate for codifying.
- **The Settings field for "required in prod, defaulted in tests"** — did the agent invent a pattern? Worth documenting?
- **The 401-vs-404 decision** — should be in `docs/architecture.md` § "security defaults" if not already
- **A "logged-in test client" fixture** — where does it live? `tests/conftest.py`? How is it shared across integration and e2e tiers?

### Things that would justify a skeleton fix

- "I had to change Settings to support nested config"
- "The Item domain model couldn't accept a new field without breaking other tests"
- "I needed a request-scoped state and the skeleton has no pattern for it"
- "The frontend's lib/api.ts had no clean place to inject auth headers"

## Findings (fill in after the run)

> **Run on:** _date_  
> **Agent:** _Claude version_  
> **Final commit:** _sha_  
> **Verify status:** _green / red / partial_  
> **Skeleton bugs surfaced:** _list_  
> **Promotable patterns:** _list_  
> **Status:** _⏳ / 🟡 / ✅ / 🟠 / ❌_
