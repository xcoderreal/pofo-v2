# Environments

The practical runbook for dev, test, and production configuration. Two independent env-var toggles, four real cells — no fifth mode, no scattered branching. For the domain reasoning behind *why* real auth is required, see [`docs/auth.md`](auth.md) and [`docs/security.md`](security.md).

## The two toggles

```bash
MYAPP_AUTH=stub|supabase
MYAPP_REPOSITORY=memory|supabase
```

Independent, both resolved **once**, at `lifespan` startup, into a single constructed adapter placed on `app.state` — exactly the pattern the skeleton already uses for repositories (`get_repo(request)` reads `request.app.state`). Auth mirrors this exactly: `get_current_user(request)` reads a pre-constructed `AuthProvider` off `app.state`. No `if settings.auth == "stub"` branch exists anywhere outside that one construction site in `lifespan`.

```python
class AuthProvider(ABC):
    def get_user(self, request: Request) -> User: ...

class StubAuthProvider(AuthProvider):
    """Always returns a fixed, hardcoded Dev User. Hard-guarded out of production."""

class SupabaseAuthProvider(AuthProvider):
    """Verifies a real Supabase-issued JWT, returns claims as a domain User."""
```

**Production guard:** `Settings` must raise at startup if `env == "production" and auth == "stub"`. This is a hard requirement — see `docs/security.md` for why (`stub` bypasses RLS via the service-role key; on a public deployment with real financial data, that means anyone with the URL has full read/write access).

## The four cells

| Cell | Purpose | Notes |
|---|---|---|
| `memory` + `stub` | Fastest offline dev loop | No persistence, no login friction. Default for `just api` with no env file. |
| `memory` + `supabase` | Testing the JWT-verification path in isolation | Real auth check, `FakeRepository` underneath — useful for unit/integration tests of `get_current_user` without needing a live DB. |
| `supabase` + `stub` | Manual click-through dev with real persistence | The main day-to-day dev workflow: real data, zero login friction. |
| `supabase` + `supabase` | Real end-to-end | Local Supabase e2e tests, and production. Distinguished from each other only by *which* Supabase project the URL/key point to — not a new toggle. |

## Seeding across all four cells

Seeding takes exactly one resolved input: `user_id`. It asks the active `AuthProvider` for the identity to attach seeded data to — the Stub Auth constant, or the real seeded Dev User's Supabase UUID — so the same seed script works unmodified in every cell.

**The dev-user re-provisioning problem, solved:** `supabase-reset dev` (or equivalent) wipes `auth.users` along with everything else, including any manually-created login. A `just seed-dev-user` step (or folded into the reset recipe) calls the Supabase Admin API to recreate the same fixed dev account — known email, known password, stable UUID — immediately after every reset. One command, zero manual dashboard clicking, ever. This is what makes `supabase + supabase` locally viable for day-to-day auth-path testing without the friction that motivated keeping `stub` around at all.

Seed data (accounts, instruments, transactions) never triggers a live price fetch — trade price lives on the `Transaction` itself (see `docs/domain-model.md`). Reseeding is instant and offline regardless of which cell is active.

## `.env.sample` additions

When implementing, add to `apps/api/.env.sample` (mirroring the existing `MYAPP_SECRET_KEY`/`MYAPP_PORT` comment style):

```bash
# "stub" (default) returns a fixed Dev User — fine for local dev and CI.
# Production must be "supabase" — a startup check rejects "stub" in production.
MYAPP_AUTH=stub

# "memory" (default) uses in-memory repositories — no persistence, fastest loop.
# "supabase" persists through a real Supabase project (see below).
MYAPP_REPOSITORY=memory

# Required when MYAPP_REPOSITORY=supabase.
MYAPP_SUPABASE_URL=
MYAPP_SUPABASE_KEY=          # Secret API key (sb_secret_...), backend-only, never sent as Bearer auth

# Required when MYAPP_AUTH=supabase.
MYAPP_SUPABASE_JWT_SECRET=   # verifies Supabase-issued JWTs
```

## Migrations

Migration source of truth: `apps/api/supabase/migrations`. Every migration that adds a user-owned table includes its RLS policy in the same file — RLS is not a follow-up migration, it lands with the table (see `docs/security.md`).

For hosted Supabase projects, promote explicitly: apply to the dev/test project, run the real-Supabase e2e suite, only then push the same migration set to production.
