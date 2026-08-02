# How we arrived at the "invariant core / swappable edges" framing

Working notes from the session that landed `docs/architecture.md § "Layering"`. Not committed — this captures the reasoning journey so we can revisit if the rules don't hold under experiment pressure.

## Starting point

v4-02 (auth) surfaced a question: **is `get_current_user()` a tight coupling of the framework?** The agent put it in `entrypoints/api.py:62` as a FastAPI `Depends` that returns a domain `User`, then routes extract `current_user.id` and pass `owner_id=…` into the service layer.

Answer: no — this is actually the *cleanest* shape. The coupling is confined to `entrypoints/`, which is where framework coupling is allowed. The service layer never sees FastAPI, never sees `Request`, never sees `User` as a parameter. It takes `owner_id: str`.

That observation generalized into: **the skeleton has an invariant core (entrypoints → service → domain ← adapters) and two swappable edges (identity source on top, storage backend on bottom).** Same layering diagram, just with the stack-specific parts called out explicitly.

## The four rules (first draft)

1. Auth lives in `entrypoints/`. `get_current_user` is the only place that parses identity.
2. Services take `owner_id: str`, never `User` or `Request`.
3. Ownership is a repository concern (every read/write takes `owner_id`), not a service concern.
4. The repository ABC speaks domain terms, not storage terms.

Rule 4 was framed as "for every backend to implement cleanly." It pushed toward lowest-common-denominator design — the ABC had to fit memory AND Redis AND DynamoDB.

## The 90% reframe

User pushback (from a podcast): **instead of making an abstraction generic for every case, build for the 90% case and let the 10% be a one-off customization.**

This changed Rule 4. The old framing said "design the ABC so every possible backend maps cleanly." The new framing says "design the ABC for the common relational-ish CRUD shape; if you pick DynamoDB and hit an impedance mismatch, customize your adapter." The skeleton admits it's optimized for relational CRUD (which covers 90%+ of real apps) and doesn't pretend to be backend-neutral.

**New Rule 4:** "The ABC fits the 90% case. The 10% case customizes its adapter."

**Rule of three:** first caller with an edge-case need solves it as a one-off on their specific adapter. Second caller copies the pattern. Third caller promotes it into the ABC. Same heuristic as "three similar lines beats a premature abstraction," applied to the repository contract.

## Consequences for the ABC

The 90% framing made three previously-open questions answerable:

**Pagination** — stays out of the ABC. Defer until a list call is actually slow. When it shows up, the first caller picks offset vs cursor based on their access pattern. Preemptive pagination designs almost always get rewritten.

**Transactions** — stay out of the ABC. Per-method atomicity (which every real DB gives on a single statement) is enough for CRUD. If a multi-step atomic requirement appears, introduce Cosmic Python's **Unit of Work** pattern at the *service* layer — it wraps existing repositories without changing their interfaces. UoW is NOT in the ABC; it's a wrapper around ABCs.

**Batch ops** — different problem from transactions, often conflated. Batch = "do N similar things efficiently in one adapter call." Current `ItemRepository.add_many` handles this; under rule-of-three it should probably drop (no service-layer caller, just one test fixture) until a real need appears.

## The answer to "what should the ABC actually look like"

```python
class ItemRepository(ABC):
    def list_for_owner(self, owner_id: str) -> list[Item]: ...
    def get(self, item_id: str, owner_id: str) -> Item | None: ...
    def add(self, item: Item) -> None: ...
    def delete(self, item_id: str, owner_id: str) -> None: ...
```

Four methods. Owner-scoped where it matters. No pagination. No commit. No batch. This is the "minimal but opinionated enough" shape.

**Not landed yet** — the skeleton's current ABC is still the pre-auth shape (`list_all`, `get(id)`, `add`, `add_many`). v4-02 v2 will test whether an agent reading the new architecture.md section arrives at this shape when adding auth. If they do, the docs are load-bearing. If they don't, we fix the docs and re-run (same pattern as v4-01's three rounds).

## Q&A on auth that happened alongside the rule changes

### 1. Supabase + RLS

If someone adopts Supabase, prefer **Supabase Auth + Row Level Security** over hand-rolling auth on top of a `SupabaseItemRepository`. RLS pushes ownership enforcement down to the row, so:

- `list_for_owner(owner_id)` becomes `SELECT * FROM items` — the policy filters
- You can't forget a `WHERE owner_id = ?` and leak data
- Same policy protects REST, GraphQL, and realtime channels

`get_current_user` shrinks to "verify Supabase JWT, return claims as domain User." Service layer stays identical — still takes `owner_id: str`.

Tradeoff: access-control rules live in SQL policies, not Python. Different place to audit. Fine for solo dev, mild cost for teams with no SQL fluency.

Worth a one-paragraph note in `docs/architecture.md` alongside the adapter guidance once v4-02 closes.

### 2. v4-02 didn't add web tests — gap?

Yes — real skeleton gap, not agent failure. The agent built 3 UI states (booting / auth / items) and a security-critical flow, but never touched `tests/web/`. Existing smoke spec would still pass if the login button did nothing.

**Fix landed:** CLAUDE.md § "Testing philosophy" now has a bullet: *"Every new screen or user flow gets a Playwright web test."* v4-02 v2 + v4-03 should now write web tests without prompting.

### 3. Security

Recommending "prefer a well-known crypto library" is the conservative default, but auth code warrants its own review pass separate from `just verify`. Skeleton currently has no such pass.

**Not landed yet.** Two cheap additions would help:
- `docs/security.md` — checklist (hash algo + params, JWT alg pinning, token storage, timing-safe comparison, secret rotation, rate limiting on `/auth/*`)
- `/security-review` slash command that reads the checklist and audits the diff

Deferred — needs more thought about what's in the checklist vs what's in `just verify`.

### 4. `get_current_user` coupling

It's a coupling, but contained. Lives in `entrypoints/`, which is where framework coupling is allowed. Returns a domain `User`. Route handler extracts `current_user.id` and passes `owner_id: str` into the service. Service never sees FastAPI.

Alternatives would be worse:
- Contextvars / request-scoped globals — hidden state, untestable without mocking
- `current_user` as a service-layer parameter — drags auth into every service signature
- Middleware stuffing user into `request.state` — still FastAPI-coupled, less type-safe

**Rule 1** codifies this: auth lives in entrypoints, nothing downstream imports it. The one risk is drift — a future agent adding `Depends(get_current_user)` as a service-method parameter. The rule prevents that drift.

## What still needs validation

v4-02 v2 will test whether:

1. Agent reading new architecture.md arrives at the owner-scoped ABC shape without prompting
2. Agent writes a Playwright spec when adding new screens (round-2 CLAUDE.md rule)
3. Agent cites the four rules from architecture.md in its RETRO (signal that docs are reachable, not just present)

v4-04 will test whether:

1. Rule 4 generalizes from storage adapters to network adapters
2. A `PriceSource` ABC shows up in `domain/`, concrete in `adapters/`
3. Caching ends up in the adapter, not in the service
4. Test pyramid story from `docs/testing.md § "Where adapter conformance lives"` generalizes beyond storage

If v4-02 v2 arrives at the right shape and v4-04 validates rule 4, the "invariant core / swappable edges" framing is load-bearing.
