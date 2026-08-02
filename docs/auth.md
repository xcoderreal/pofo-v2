# Auth

Real Supabase Auth + JWT + Row Level Security, required from v1 — not deferred. This is real financial data (account balances, holdings) on a public deployment; unlike the skeleton's generic placeholder (archived at `docs/archive/auth.md`), "ship with `stub` and add login later" is not an acceptable posture here. See `docs/security.md` for the production-access-control reasoning.

For the two-toggle mechanics (`MYAPP_AUTH`, `MYAPP_REPOSITORY`) and the dev-user re-provisioning workflow, see [`docs/environments.md`](environments.md). This doc covers the auth *design*; that one covers the *runbook*.

## Pattern: JWT in entrypoints, `user_id` everywhere downstream

```
get_current_user()          ← entrypoints/ (parses identity, via AuthProvider on app.state)
        │
        ▼
    user_id: str            ← service/ (framework-free, auth-free)
        │
        ▼
    list_for_user(user_id)  ← domain/ + adapters/ (user-scoping as a data concern)
```

Route handlers extract `current_user.id` and pass `user_id: str` into service methods. The service layer never sees `User`, `Request`, or `Depends` — it takes `user_id: str` and returns domain objects. **`user_id` is the canonical field name everywhere** — not `owner_id` (an earlier skeleton generation used `owner_id`; this repo standardizes on `user_id` throughout, matching the sibling forks that already made this rename).

## Supabase Auth + Row Level Security

RLS pushes user-scoping enforcement down to the database row instead of trusting every query to remember a `WHERE user_id = ?`:

- `list_for_user(user_id)` becomes `SELECT * FROM transactions` — the RLS policy filters by the JWT's `sub` claim.
- You can't forget the filter and leak another user's portfolio.
- The same policy protects REST, GraphQL, and Supabase Realtime uniformly.

**Every migration that creates a user-owned table includes its RLS policy in the same migration** — not a follow-up. See `docs/security.md`'s checklist and `docs/environments.md`'s migration section.

`get_current_user` in `MYAPP_AUTH=supabase` mode shrinks to: verify the Supabase JWT (their JWKS), return claims as a domain `User`. The service layer is identical to the stub path — still `user_id: str` in, domain objects out.

## Why `stub` exists, and why it's not a production shortcut

`MYAPP_AUTH=stub` returns one fixed, hardcoded Dev User for every request — no JWT, no login. It exists purely to keep local dev/CI fast and low-friction (see `docs/environments.md`'s four-cell matrix). It is **not** a lighter-weight production auth mode: `stub`-backed requests hit Supabase with the service-role key, which bypasses RLS entirely. A `Settings` startup check rejects `MYAPP_ENV=production` combined with `MYAPP_AUTH=stub` — this must never be a config mistake that ships silently.

## 401 / 404 policy

- **Cross-user reads return 404, not 403.** Don't leak an Account or Transaction's existence to a user who doesn't own it — "not found" whether it doesn't exist or belongs to someone else.
- **Unknown-email login returns 401, not 404.** Same principle — don't leak account existence via the error code.
- **`/health` stays unauthenticated.** It's a probe endpoint for load balancers/uptime monitors.

## Token storage

| Platform | Approach |
|---|---|
| Web | `httpOnly` cookie for production (not `localStorage` — this is real financial data, not a prototype) |
| iOS | `expo-secure-store` (encrypted keychain, survives restarts) |

## Crypto/library choices

- **JWT verification:** verify against Supabase's JWKS (their library/endpoint), not hand-rolled HS256 — algorithm pinning and `exp`/`nbf` validation matter here.
- No password hashing is implemented directly in this codebase — Supabase Auth owns credential storage.

## Adding auth to a new resource

Per `CLAUDE.md`'s "Adding a new resource" checklist, step 7 (entrypoints) gains one sub-step: add `current_user: User = Depends(get_current_user)` to the route handler and pass `user_id=current_user.id` into the service method. The rest of the 9-step pattern is unchanged — domain, service, and adapter layers don't know auth exists.
