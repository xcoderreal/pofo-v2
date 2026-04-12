# Auth

The skeleton ships without authentication. This guide covers the patterns validated by experiment v4-02 — follow them when adding auth to your fork.

## Default pattern: JWT in entrypoints

Auth lives in `entrypoints/`, nowhere else. The skeleton's layering rules apply:

```
get_current_user()          ← entrypoints/ (parses identity)
        │
        ▼
    owner_id: str           ← service/ (framework-free, auth-free)
        │
        ▼
    list_for_owner(owner_id) ← domain/ + adapters/ (ownership as a data concern)
```

**`get_current_user`** is a FastAPI `Depends` function that:
1. Reads the `Authorization: Bearer <token>` header
2. Verifies the JWT
3. Returns a domain `User` object (plain `@dataclass`, not Pydantic)

Route handlers extract `current_user.id` and pass `owner_id: str` into service methods. The service layer never sees `User`, `Request`, or `Depends` — it takes `owner_id: str` and returns domain objects.

### Crypto choice

The skeleton's "no new dependencies for hypothetical needs" rule applies to *most* deps, but **security-sensitive libraries are an exception**. For production auth, prefer well-known libraries:

- **Password hashing:** `passlib` + `bcrypt` or `argon2-cffi`. Stdlib `hashlib.pbkdf2_hmac` with 200k+ iterations is defensible as a starting point, but bcrypt/argon2 are better defaults for production.
- **JWT:** `pyjwt`. Hand-rolling HS256 with `hmac` + `base64` works but you lose algorithm pinning, `exp`/`nbf` validation, and JWKS support.

If you choose stdlib-only for rapid prototyping, document the decision and plan to migrate before production.

### Token storage

| Platform | Recommended | Why |
|---|---|---|
| Web | `localStorage` (prototype) or `httpOnly` cookie (production) | `localStorage` is simpler but vulnerable to XSS; `httpOnly` cookies are immune to JS-based token theft |
| iOS / Android | `expo-secure-store` | Encrypted keychain / keystore; survives app restarts |
| Native + web shared | Token in memory + refresh from secure store on cold start | Avoids platform-specific branching in shared code |

For a skeleton/prototype, `localStorage` on web is acceptable. Flag it for migration before shipping to real users.

## Supabase path: built-in auth + Row Level Security

If you adopt Supabase as your persistence layer, **prefer Supabase Auth + RLS** over hand-rolling auth on top of a `SupabaseItemRepository`.

RLS pushes ownership enforcement down to the database row:
- `list_for_owner(owner_id)` becomes `SELECT * FROM items` — the RLS policy filters by the JWT's `sub` claim
- You can't forget a `WHERE owner_id = ?` and leak data
- The same policy protects REST, GraphQL, and Supabase Realtime channels

In this model, `get_current_user` shrinks to "verify Supabase JWT (their JWKS), return claims as a domain `User`." The service layer stays identical — still takes `owner_id: str`, still returns domain objects.

**Tradeoff:** access-control rules live in SQL policies rather than Python. Different place to audit, different skill to write. Fine for solo dev; mild cost for teams without SQL fluency.

## 401 / 404 policy

- **Cross-owner reads return 404, not 403.** Don't leak item existence to users who don't own the item. "Item not found" whether it doesn't exist or belongs to someone else.
- **Unknown-email login returns 401, not 404.** Same principle — don't leak account existence via the error code.
- **`/health` stays unauthenticated.** It's a probe endpoint for load balancers and uptime monitors.

## Adding auth to a resource

Once auth is in your fork, the "Adding a new resource" checklist in CLAUDE.md grows one sub-step at step 7 (entrypoints):

> Add `current_user: User = Depends(get_current_user)` to the route handler and pass `owner_id=current_user.id` to the service method.

The rest of the 9-step pattern is unchanged — domain, service, and adapter layers don't know auth exists.
