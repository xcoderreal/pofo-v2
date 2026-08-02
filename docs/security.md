# Security

Unlike the skeleton's generic placeholder (archived at `docs/archive/security.md`), this is a project-specific checklist reflecting real decisions made for this app, not a TODO stub.

## Why real auth is a v1 gate, not deferred infra

This app holds real account balances and holdings on a (planned) public deployment. The default "ship with `MYAPP_AUTH=stub` in production, add login later" posture — which is what the skeleton's reference sibling forks do for their own (lower-stakes, hypothetical/planning) data — was explicitly rejected during design for this app: `stub` mode uses the Supabase **service-role key**, which bypasses RLS entirely. If deployed with `stub` in production, anyone who finds the URL has full read/write access to real financial data with no password, no token — obscurity of the URL is not a security boundary. See `docs/auth.md` for the full design.

## RLS checklist

- [ ] Every table holding user data has a `user_id` column and an RLS policy landing in the *same* migration that creates the table — never a follow-up.
- [ ] RLS policies use `auth.uid() = user_id`, verified against real fixture JWTs (two distinct test users) in a dedicated test tier that talks to PostgREST directly — **not** only exercised through the app (the app's own dev-loop convenience mode, `stub`, uses the service-role key and bypasses RLS, so it can never be the thing that proves a policy works).
- [ ] The backend's Supabase Secret API key (service-role, RLS-bypassing) is used **only** for backend-owned operations (repository writes on behalf of an authenticated `user_id` already verified by the app layer) — never exposed to the frontend, never used to serve a request without an already-verified `user_id`.
- [ ] `MYAPP_AUTH=stub` is hard-rejected at startup when `MYAPP_ENV=production` (see `docs/auth.md`).

## Access control

- [ ] Production requires `MYAPP_AUTH=supabase` with real JWT verification against Supabase's JWKS. `alg` is checked explicitly; `alg: none` is never accepted.
- [ ] Cross-user reads return 404, not 403 (don't leak resource existence — see `docs/auth.md`).
- [ ] Token storage: `httpOnly` cookie on web, `expo-secure-store` on iOS — not `localStorage` (see `docs/auth.md`).
- [ ] `MYAPP_CORS_ORIGINS` is the actual deployed frontend origin(s) in production — never `["*"]`.
- [ ] All auth-relevant endpoints served over HTTPS in production (Vercel default).
- [ ] Secrets (`MYAPP_SUPABASE_KEY`, `MYAPP_SUPABASE_JWT_SECRET`, `MYAPP_SECRET_KEY`) are never committed, never the skeleton's default placeholder values in production.

## Dev-user convenience vs. production posture — kept structurally separate

`docs/environments.md`'s four-cell auth/persistence matrix exists specifically so local dev velocity (`stub`, no login friction, automated dev-user reseeding) never has to compromise production posture (`supabase`, real RLS, hard-guarded). These are enforced as a config-validation invariant, not a documentation-only convention — see `docs/auth.md`'s startup check.

## When to revisit this checklist

- Before first deploy with `MYAPP_REPOSITORY=supabase` pointed at a production project.
- Before enabling any new externally-reachable endpoint that touches `Transaction`/`Account` data.
- If `/security-review` is run, this file is its reference for this repo.
