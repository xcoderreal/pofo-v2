# Deployment

Vercel (frontend + Python serverless, per the skeleton's existing `docs/vercel.md`) plus Supabase as the managed persistence/auth layer. This doc covers the Supabase side and how dev/test/prod stay isolated; read `docs/vercel.md` first for the base Vercel deploy mechanics (those are unchanged by this app's domain).

## Three Supabase projects, never shared

| Project | Used by | Why separate |
|---|---|---|
| **Dev** | Local `supabase + stub` click-through dev (`docs/environments.md`) | Disposable — reset freely (`supabase-reset dev`), never holds data you'd mind losing |
| **Test** | Real-Postgres/PostgREST e2e tests, including the RLS-enforcement test tier (`docs/security.md`) | Never shares data with dev or prod; safe for automated tests to create/destroy fixture users and rows |
| **Production** | The real deployed app | Holds real financial data; the only project where `MYAPP_AUTH=stub` is hard-rejected at startup |

## Migration promotion flow

Migrations live at `apps/api/supabase/migrations` (source of truth). Promote explicitly, never push directly to production:

```bash
supabase db push --project-ref <dev-project-ref>
# run the app manually against dev, confirm the new table/RLS policy behaves
just test-e2e-supabase-local          # against the test project
supabase db push --project-ref <prod-project-ref>
```

Every migration that creates a user-owned table includes its RLS policy in the same file (`docs/security.md`). There is no "add RLS later" migration pattern in this app.

## Environment variables (Vercel)

Set per Vercel environment (Preview vs. Production), mirroring `docs/environments.md`'s `.env.sample`:

```bash
MYAPP_ENV=production
MYAPP_SECRET_KEY=<strong random secret, not the skeleton default>
MYAPP_REPOSITORY=supabase
MYAPP_SUPABASE_URL=https://<prod-project-ref>.supabase.co
MYAPP_SUPABASE_KEY=<prod Secret API key, sb_secret_...>
MYAPP_AUTH=supabase
MYAPP_SUPABASE_JWT_SECRET=<from Project Settings → API → JWT Secret>
MYAPP_CORS_ORIGINS=https://<production frontend URL>
```

Optional, only if Preview deploys need it: `MYAPP_CORS_ORIGIN_REGEX` for Vercel's per-PR preview origin pattern.

## Price sync in production (v1: still lazy)

No cron job in v1 — see `docs/non-goals.md`. Production `market_price` history is populated the same lazy, on-demand way as dev: the first real chart view for a symbol triggers the first fetch, gap-filled and cached from then on. Nothing in the deployment pipeline pre-warms price data.

## Rollback

- **App code:** standard Vercel rollback to a prior deployment.
- **Schema:** migrations are append-only once applied to a long-lived environment (dev is the exception — freely reset). A bad migration in prod is fixed by a new forward migration, not an edit to the applied one.
