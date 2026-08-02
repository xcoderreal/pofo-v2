# Security

Checklist for auditing auth and crypto when added to a fork. This is a TODO-level placeholder — `/security-review` will use this as its reference.

## Checklist

- [ ] **Password hashing:** algorithm + iteration params meet OWASP current baseline (bcrypt cost 12+, argon2id with recommended params, or PBKDF2-SHA256 at 200k+ iterations)
- [ ] **JWT algorithm pinning:** verify explicitly checks `alg: HS256` (or whichever you chose). Never accept `alg: none`.
- [ ] **Timing-safe comparison:** token/password verification uses `hmac.compare_digest` or equivalent, not `==`
- [ ] **Token storage:** web uses `httpOnly` cookie for production (not `localStorage`), native uses `expo-secure-store`
- [ ] **Secret rotation:** `MYAPP_SECRET_KEY` / `MYAPP_JWT_SECRET` are distinct values, not the default `change-me`; there's a plan for rotating them without downtime
- [ ] **Rate limiting on `/auth/*`:** brute-force login attempts are throttled (e.g. `slowapi`, Cloudflare rate rules, or Supabase's built-in rate limits)
- [ ] **401 vs 404 policy:** cross-owner reads return 404 (see [`docs/auth.md`](auth.md)); unknown-email login returns 401
- [ ] **No secrets in responses:** password hashes never appear in any API response
- [ ] **CORS policy:** `allow_origins=["*"]` is replaced with actual origins before production
- [ ] **HTTPS:** all auth endpoints are served over TLS in production

## When to run this checklist

- Before first deploy with auth enabled
- After changing password hashing parameters
- After changing JWT signing algorithm or key
- After adding a new auth-related endpoint
