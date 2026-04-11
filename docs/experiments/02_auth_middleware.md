# Experiment 02 — Auth middleware

**Tests:** the layering accommodates a cross-cutting concern (request-scoped user context, permission checks) without leaking auth into the domain or service layer.

**Status:** ⏳ Not yet run.

---

## The full prompt (copy verbatim into a fresh Claude Code session)

```
Add JWT-based authentication to this skeleton. Items become user-scoped:
each item belongs to a specific user, users only see their own items,
unauthenticated requests get 401, requests with someone else's token
trying to access an item return 404 (not 403 — don't leak existence).

CLAUDE.md has the layering rules, testing conventions, file-path
conventions, commands, and "adding a resource" ordering. Follow it —
I'm not restating it here. If something in CLAUDE.md is unclear, stop
and ask before inventing a convention.

What you need to build:
  - A User domain model (id, email, hashed_password) — pure dataclass,
    no ORM, no Pydantic in domain/
  - A UserRepository ABC + MemoryUserRepository implementation following
    the same pattern as ItemRepository
  - A UserService that handles signup (hash password, store) and
    authenticate (verify password, return user or None)
  - JWT issuance and verification — use PyJWT (a minimal, well-known
    library; add it to apps/api/pyproject.toml dependencies)
  - Password hashing — use passlib[bcrypt] or argon2 (your call, but
    document the choice in the RETRO)
  - POST /auth/signup — creates a user, returns a JWT
  - POST /auth/login — verifies credentials, returns a JWT
  - GET /me — returns the current authenticated user's info
  - The Item resource becomes user-scoped:
      * Item domain model gains a `user_id: str` field
      * ItemRepository methods that take `user_id` for filtering
      * ItemService methods that enforce ownership
      * /items endpoints require auth, only return the user's items
      * GET /items/{id} returns 404 if the item exists but belongs to
        someone else (no existence leak)

Test discipline:
  - Unit tests for UserService (signup, authenticate happy + sad paths)
    in tests/unit/service/test_user_service.py
  - Unit tests for the JWT module (issue, verify, expired, malformed)
    in tests/unit/auth/test_jwt.py (or wherever you put the JWT logic)
  - Integration tests for /auth/signup, /auth/login, /me, and a
    user-scoped item flow (signup as user A, create item, signup as
    user B, verify B can't see A's item)
  - Smoke test additions: /auth/signup + /me round-trip
  - E2E tests for the full auth + items flow

Scope:
  - In-memory storage only — both User and Item live in memory
    repositories. (If the persistence experiment 01 is already done,
    you may use SQL instead, your call. Either way the abstraction
    should be the same.)
  - No password reset, no email verification, no OAuth, no refresh
    tokens, no rate limiting, no admin role. JWTs have a 24-hour
    expiry and that's it.
  - Bcrypt or argon2 for password hashing — pick one and stick with it.
  - JWT secret comes from Settings (pydantic-settings env var). It
    should ERROR at startup if the secret is unset and we're not in
    test mode.

Rules of engagement (beyond CLAUDE.md):
  - The domain layer (apps/api/src/myapp/domain/) must stay
    framework-free. The User dataclass and UserRepository ABC live
    here. Password HASHING is also pure logic (no I/O), so it can
    live in domain or in a small auth module — your call, but no
    PyJWT or passlib imports in domain.
  - JWT issuance/verification involves a library — that goes in
    a new directory like apps/api/src/myapp/auth/ (parallel to
    domain, service, adapters, entrypoints). It depends on Settings
    for the secret.
  - The "current user" needs to flow from the request to the service
    layer. Use FastAPI Depends() to extract+verify the JWT, return a
    User domain object, and inject it into the service call. The
    service receives a User as a parameter — it does NOT know how
    the user was authenticated.
  - 401 vs 404 — when an item exists but belongs to another user,
    return 404 (treat it as "doesn't exist for you"). This is the
    correct security behavior; document the choice.

Suggested milestones (one commit each):
  1. User domain model + UserRepository ABC + MemoryUserRepository +
     fake + unit tests
  2. UserService (signup + authenticate) + unit tests
  3. JWT module (issue + verify) + unit tests
  4. /auth/signup, /auth/login, /me routes + integration tests
  5. Add user_id to Item model, update ItemRepository / ItemService /
     routes to be user-scoped, update existing tests
  6. Smoke + e2e tests for the auth flow
  7. Frontend: a tiny login screen that signs up / logs in and stores
     the token in expo-secure-store, sends it in subsequent requests

Definition of done:
  - just verify is green (all five tiers, including the new auth
    test files)
  - I can sign up via the frontend, see an empty list, create an
    item, log out, sign up as a different user, see THAT user's
    empty list (not the first user's items)
  - GET /items/{id} for an item that exists but belongs to another
    user returns 404, not 403
  - The Item DOMAIN MODEL has a user_id field, but the change
    to user-scoped behavior is implemented in the service+repository
    layers, not in route handlers
  - The /me endpoint returns the user's email and id (not the
    password hash)
  - JWT secret is required from env in production but defaulted in
    test mode

Frontend constraints:
  - One new screen (apps/mobile/app/login.tsx or auth.tsx)
  - Use expo-secure-store to persist the JWT (npx expo install
    expo-secure-store, this is a legitimate new dep for auth)
  - The home screen redirects to login if no token is present
  - lib/api.ts gains an Authorization header on all requests when
    a token is set
  - No state management library beyond local useState and a tiny
    auth context (one Context, one provider, one hook) — that's
    NOT a state management library, that's React's primitive

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

### Hard gates (binary)

- `just verify` exits 0 with all new test files included
- `git diff main -- apps/api/src/myapp/domain/` shows ONLY the new `User` dataclass and the `user_id` field added to `Item` — no Pydantic imports, no PyJWT imports, no passlib imports
- `git diff main -- apps/api/src/myapp/service/` shows the new UserService and the user-scoping logic in ItemService — no JWT decoding, no FastAPI imports
- A new `apps/api/src/myapp/auth/` directory exists, separate from the layering quartet (domain/service/adapters/entrypoints)
- 401 returned for unauthenticated requests; 404 returned when accessing another user's item
- Password hash is NEVER returned in any response

### Soft signals (judgment calls)

- The dependency injection pattern for "current user" is clean — `def some_route(user: User = Depends(get_current_user))` rather than passing the request through
- The service layer methods have user as a parameter, not as a thread-local or context var
- The `get_current_user` dependency returns a `User` domain object, not a Pydantic model or a dict
- JWT verification errors are caught and translated to 401, not 500
- The frontend auth context is small (~30 lines), not a state management library
- Token storage uses expo-secure-store on native, document.cookie or localStorage on web — agent's choice but should be defensible

### Skeleton-improvement signals (what to look for)

- **Where did `auth/` end up?** Sibling to domain/service/adapters/entrypoints, or inside one of them? CLAUDE.md doesn't currently say. Whichever the agent picked is a candidate for codifying.
- **How did the agent handle "Settings field required in prod, defaulted in tests"?** Did they invent a pattern? Is it general enough to document?
- **Did the agent add a new layer rule** to CLAUDE.md's import table for `auth/`? Should it be allowed to import from `domain/` and `adapters/` but not `entrypoints/`?
- **The 401-vs-404 decision** — is there a place in the codebase where this is documented? If not, it's a candidate for `docs/architecture.md` § "security defaults" or similar.
- **How was the existing Item test suite updated?** Did the agent add a test fixture that creates an authed test client? Where does that fixture live?

### Things that would justify promoting to baseline

- A clean `current_user` dependency pattern → worked example in `docs/architecture.md`
- An "auth/" layer → add to the layering table in CLAUDE.md
- A test fixture for "logged-in client" → document in `docs/testing.md`

### Things that would justify a skeleton fix

- "I had to change Settings to support nested config" → Settings shape should be extensible
- "The Item domain model couldn't accept a new field without breaking other tests" → tests are too coupled to the field set
- "I needed a request-scoped state and the skeleton has no pattern for it" → a `RequestContext` or similar primitive should be added
- "The frontend's lib/api.ts had no clean place to inject auth headers" → lib/api.ts needs a request interceptor pattern

## Findings (to be filled in after the run)

> **Run on:** _date_  
> **Agent:** _Claude version_  
> **Final commit:** _sha_  
> **Verify status:** _green / red / partial_  
> **Skeleton bugs surfaced:** _list_  
> **Promotable patterns:** _list_  
> **Status:** _⏳ / 🟡 / ✅ / 🟠 / ❌_
