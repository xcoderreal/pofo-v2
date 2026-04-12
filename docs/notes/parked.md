# Parked questions / ideas

Things surfaced during the v4 experiment round that we've deliberately **not** acted on yet. Revisit in one pass once v4-02 v2 + manual tests of v4-03 and v4-04 are all in.

Not committed. When something here gets decided, either land it in the skeleton or delete the entry.

---

## 1. Replace `@lru_cache` on `get_repo` with `lifespan` + `app.state`

**Surfaced by:** v4-03 (web test isolation question). Traces back to commit `b4cca80`.

**The problem:**
- `@lru_cache(maxsize=1)` is semantic abuse — memoization decorator used as a singleton-lifetime pattern
- Lifecycle is invisible — "when does the repo get created?" → "first request that triggers `Depends(get_repo)`"
- No teardown hook — real DBs want to close connection pools on shutdown
- Not idiomatic FastAPI — community uses `lifespan` + `app.state`
- v4-02 v1 and v4-03 both copied the pattern into `get_user_repo` / `get_auth_service`, so the anti-pattern is spreading

**The fix (sketch):**
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.repo = MemoryItemRepository()
    yield

app = FastAPI(lifespan=lifespan)

def get_repo(request: Request) -> ItemRepository:
    return request.app.state.repo
```

**What it does NOT fix:** web-tier test isolation. That's `workers: 1` territory, separate concern.

**Why parked:** landing it now makes v4-02 v1 and v4-02 v2 incomparable. Wait for v4-02 v2 to finish (it'll test the old pattern one more time), then refactor as part of the follow-up batch.

**Size:** ~10-line code change + CLAUDE.md note + architecture.md "Adding a new adapter" step 2 update.

---

## 2. Playwright `workers: 1` default

**Surfaced by:** v4-03 `items.spec.ts` using `test.describe.configure({ mode: "serial" })` + `resetAndSeed`.

**The problem:** `serial` mode only affects tests within a file. Cross-file parallelism still races on the shared singleton backend. `smoke.spec.ts` + `items.spec.ts` could run in different workers hitting the same backend. Today `smoke` is read-only so it's fine, but the moment a second mutating test file lands, resets race across files.

**The fix:** set `workers: 1` in `playwright.config.ts`. Simpler, future-proof, lets future test files drop the per-file `test.describe.configure` boilerplate.

**Plus a doc note:** document the reset-in-beforeEach pattern in `docs/testing.md § Web tier` so future agents don't re-invent it.

**Size:** one-line config + small docs addition.

---

## 3. Rule-of-three wording: "basic CRUD vs edge cases"

**Surfaced by:** v4-03 RETRO §3. The agent added `update`, `delete`, `list_tags` directly to `ItemRepository` (instead of one-off on an adapter) and justified it with:

> "CLAUDE.md's 'rule of three' applies to edge cases like pagination; basic CRUD extensions to the single existing resource are the 90% shape the ABC is meant to hold."

**That's the correct reading**, but `docs/architecture.md § "Layering"` doesn't explicitly separate "basic CRUD = always in the ABC" from "edge cases = rule of three." The agent inferred it correctly this time; a future one might not.

**The fix:** one sentence in the "rule of three for growing the ABC" paragraph, explicitly naming basic CRUD (create/read/update/delete) as *not* subject to rule-of-three. Only faceted queries, pagination, batch, transactions, upsert, full-text search, etc. are.

**Borderline case to address:** `list_tags` is closer to "faceted query" than "basic CRUD." Agent's justification ("any realistic adapter implements it trivially") is fair but this is exactly the 10% case the rule is meant to catch. Worth a sentence about "when does a list-something-else method belong in the ABC vs a one-off."

**Size:** two sentences in architecture.md.

---

## 4. v4-03 polish items (from RETRO §6)

All four are valid. Batch-land after 02 v2 closes.

### 4a. Frontend "Adding a new screen" checklist
Mirror of backend's "Adding a new resource" 9-step list. Where new screens go, when to touch `_layout.tsx`, how to make edits visible after navigation without a state library (answer: `useFocusEffect`). **Lands in** `docs/architecture.md` (or a new `docs/frontend.md` — decide based on size).

### 4b. "testID is your Playwright seam"
Skeleton's `smoke.spec.ts` doesn't use `testID` (just asserts "page loaded"). Any real assertion needs stable selectors. **Lands in** `docs/testing.md § Web tier`, one paragraph.

### 4c. `lib/api.ts:fetchItem` same-origin bug
Real skeleton bug the v4-03 agent fixed in their scratch. `fetchItem` was using `BASE_URL` directly without `window.location.origin` prefix that `fetchItems` had — broken on Vercel. **Lands as** a fix in `apps/mobile/lib/api.ts` + a regression unit test in `apps/mobile/tests/unit/lib/api.test.ts` (the pure-fn tier).

### 4d. Web tests share backend state
Already covered by item 2 (Playwright `workers: 1`) + the convention doc.

---

## 5. `docs/testing.md` reachability — partial win, web-tier link still not followed

**Surfaced by:** v4-01 v1/v2, v4-02 v1, v4-03 — four experiments that didn't read `docs/testing.md`. v4-01 v3 and **v4-04** are the exceptions.

**Current state:** two cross-links exist:
1. `architecture.md § "Adding a new adapter"` step 4 → `docs/testing.md § "Where adapter conformance lives"`
2. `CLAUDE.md § "Testing philosophy"` web-test bullet → `docs/testing.md § "Web tier — capabilities and how to extend"`

**What works:** link #1. v4-04 followed it and explicitly cited "Where adapter conformance lives" as decisive for its test-tier split (RETRO §1). The adapter-triggered cross-link is load-bearing.

**What doesn't:** link #2. v4-02 and v4-03 both wrote Playwright tests **without** reading testing.md's Web tier section. v4-02 RETRO §1 explicitly says *"In hindsight I probably should have skimmed docs/testing.md § 'Web tier — capabilities' before writing the Playwright test."* The link is buried at the end of a long CLAUDE.md bullet.

**Consequences:**
- v4-03 re-invented the `test.describe.configure({ mode: "serial" })` + `resetAndSeed` pattern from scratch (it's not documented in testing.md today, but even if it were, v4-03 wouldn't have found it)
- v4-03 re-invented the `testID` convention (data-testid maps to testID on react-native-web)
- v4-02 wrote the auth.spec.ts using `addInitScript` to clear localStorage per test without guidance

**Fix options:**
- **A.** Split CLAUDE.md's web-test bullet into "when" + "how" with the link standing alone on its own line
- **B.** Inline the critical conventions (testID, serial+reset for mutation) directly into CLAUDE.md. Adds ~6 lines; keeps CLAUDE.md under ~160 lines total
- **C.** Ship a canonical `tests/web/_example.spec.ts.template` file that agents copy-paste from
- **D.** Accept it — agents derive the pattern from existing `smoke.spec.ts` + trial/error, and their re-inventions are close enough

**Decide at cleanup pass.** Probably A + B. Option C risks agents copying stale examples.

---

## 6. `docs/security.md` + `/security-review` command

**Surfaced by:** the earlier auth discussion. Recommending "prefer a well-known crypto library" is the conservative default, but auth code warrants its own review pass separate from `just verify`.

**Not landed.** Needs more thought about what's in the checklist vs what's already covered by `just verify`.

**Possible checklist items:**
- Password hash algo + iteration params (OWASP current baseline)
- JWT algorithm pinning (no `alg: none` accepted)
- Token storage (web: httpOnly cookie vs localStorage; native: secure store)
- Timing-safe comparison for secrets
- Secret rotation story for `MYAPP_SECRET_KEY` / `MYAPP_JWT_SECRET`
- Rate limiting on `/auth/*` endpoints
- 401 vs 404 policy (don't leak existence)

**Possible `/security-review` slash command:** reads `docs/security.md` and audits the working tree's diff against the checklist. Opt-in, not part of `just verify`.

**Decide after v4-02 v2:** if the new architecture.md § "Layering" rules land cleanly and v4-02 v2 still hand-rolls crypto, the security gap is still open and `docs/security.md` is worth writing.

---

## 7. Supabase + RLS note in architecture.md

**Surfaced by:** earlier auth discussion.

**What to add:** one paragraph in `docs/architecture.md` alongside the adapter guidance, naming Supabase Auth + Row Level Security as the preferred pattern when adopting Supabase — RLS pushes ownership enforcement to the row, so `list_for_owner(owner_id)` becomes `SELECT * FROM items` with the policy filtering. `get_current_user` shrinks to "verify Supabase JWT, return claims as domain User." Service layer stays identical.

**Why parked:** wait for v4-02 v2 to confirm the owner_id-scoped ABC shape first. If v4-02 v2 doesn't land the shape, Supabase+RLS discussion is premature.

**Size:** one paragraph in architecture.md.

---

## 8. `add_many` removal from ABC

**Surfaced by:** my own review of the ABC while writing the layering section. `add_many` at `repository.py:17` has exactly one caller: `tests/integration/test_api.py:33` as a fixture seeding helper. No service-layer caller.

**Under rule-of-three:** should drop from the ABC, inline the loop in the test.

**Why parked:** pure cleanup, no urgency. Batch with the other follow-ups. Also — v4-03's agent added new ABC methods (`update`, `delete`, `list_tags`) but didn't remove `add_many`, which tells me they read the rule correctly (basic CRUD stays, `add_many` is edge but not theirs to remove mid-experiment).

**Size:** ~5-line ABC change + ~5-line test change.

---

## 9. `data_dir` / `repository_kind` leftover discovery patterns

**Surfaced by:** v4-01 — the agent invented settings field names (`repository_kind`, `database_path`) that weren't documented anywhere. v4-01 round-2 removed a dead `data_dir` field that had accumulated.

**Status:** already handled in round-2 of v4-01. Note here just so we don't re-add dead fields.

---

---

## 10. OpenAPI → TS codegen as the contract gate

**Surfaced by:** v4-04 — backend added `ticker` + `price` fields to `ItemResponse`, frontend `lib/api.ts` never updated, `just verify` green because nothing cross-checks Pydantic ↔ TS.

**Proposal:** `bun add -d openapi-typescript`, new `just gen-api-types` recipe dumps FastAPI's `app.openapi()` to JSON and pipes through `openapi-typescript`, new `just check-api-types` recipe runs that + `git diff --exit-code`. Add `check-api-types` to `just verify`. Refactor `lib/api.ts` to import from generated `api-types.ts`.

**Resolves:** the contract-drift class of bug entirely. Generated file diff surfaces in PR review; frontend consumers can optionally derive their TS types from the generated file.

**Doesn't resolve:** UI still has to be updated to *display* new fields. The codegen raises the signal, doesn't mandate the action.

**Size:** ~30 lines hand-written + 2 generated files + 1 dev dep + 1 `just verify` step.

**Why parked:** land with other polish after v4-02 v2.

---

## 11. Stale uvicorn + `reuseExistingServer: true` footgun

**Surfaced by:** v4-02 LOG §22. Agent burned ~10 minutes when a stale uvicorn from `just api` was serving an old bundle without `/auth/signup`; Playwright's `webServer.reuseExistingServer: !CI` reused it silently. Symptoms: `just verify` fails with "Not Found" from real endpoints that `curl` confirms work. Fix: `just kill` then re-run.

**Options:**
- **A.** `docs/bootstrap.md` footnote + one-line CLAUDE.md mention (cheap, doesn't prevent)
- **B.** Set `reuseExistingServer: false` unconditionally (breaks "iterate against my `just api`" workflow)
- **C.** Have `just verify` call `just kill` first (breaks the same workflow)
- **D.** Port-check + warn-not-fail in the Playwright config (complex)

**Likely fix:** A. The "iterate against running server" workflow is valuable; breaking it to catch a 10-minute gotcha is net-negative.

---

## 12. Auth-aware step in "Adding a new resource"

**Surfaced by:** v4-02 RETRO §6 #2. Once auth lands, step 7 (entrypoints) should mention `current_user: User = Depends(get_current_user)` and `owner_id=current_user.id`.

**Why parked:** only applies after auth is in the skeleton, which isn't today.

**Size:** one-line update to CLAUDE.md's 9-step checklist.

---

## 13. 401/403/404 policy in architecture.md

**Surfaced by:** v4-02 RETRO §6 #3. Agent decided 404 (not 403) for cross-owner reads to avoid leaking item existence, and 401 (not 404) for unknown-email login to avoid leaking account existence. Generalized from DoD — would be good to codify.

**Size:** one paragraph in `docs/architecture.md § "Layering"` or a new `docs/security.md` (whichever survives the parked-#6 security-docs discussion).

---

## 14. `test-mobile-typecheck` skipped by `just verify` (real skeleton bug)

**Surfaced by:** v4-02 RETRO §6 #5. The agent flagged pre-existing tsc errors in `playwright.config.ts` and `tests/unit/lib/env.test.ts` (missing `@types/node` / `bun:test` types). **`just verify` doesn't run `tsc --noEmit`, so the skeleton ships with broken typecheck that `verify` hides.**

**This is a real skeleton bug**, not a convention gap. Needs verification against main and either (a) fix the missing types + add `test-mobile-typecheck` to `just verify`, or (b) explicitly document why verify skips typecheck.

**Priority:** high — this is the kind of silent breakage the skeleton exists to prevent.

---

## 15. Ruff N818 exception-naming note

**Surfaced by:** v4-02 LOG §21. Agent hit `N818` (exception classes should end in `Error`) late in the game, had to rename `EmailAlreadyRegistered` → `EmailAlreadyRegisteredError` etc. Not in CLAUDE.md.

**Size:** one-liner in CLAUDE.md "Things to avoid" or "Backend architecture".

**Probably overfit.** See discussion below.

---

## 16. `pydantic.EmailStr` requires extra dep

**Surfaced by:** v4-02 RETRO §6 #4. Agent reached for `EmailStr`, discovered `email-validator` isn't installed, switched to `str` + service-layer validation.

**Size:** one-line CLAUDE.md note.

**Probably overfit.** See discussion below.

---

## 17. "Adding a new adapter" needs network-client subsection

**Surfaced by:** v4-04 RETRO §6 #1. Current architecture.md § "Adding a new adapter" only covers storage. Agent wants a "If the adapter is a network client" subsection saying (a) ABC in its own `domain/<capability>.py` file, (b) caching inside the adapter not service, (c) make `httpx.Client` + clock injectable for `httpx.MockTransport` testing.

**Size:** ~15 lines in architecture.md.

**Merges with:** #22 (`repository.py` naming) — both are "non-storage adapter guidance". One subsection covers both.

---

## 18. Real-network tests note in `docs/testing.md`

**Surfaced by:** v4-04 RETRO §6 #2. One paragraph: "Real-network tests belong in e2e, not smoke. Skip gracefully on upstream unreachable. The deterministic parser/cache behavior should already be pinned by unit tests against `httpx.MockTransport`."

**Size:** one paragraph.

**Merges with:** #19 (adapter conformance generalize) — both are testing.md's adapter section growing to cover non-storage.

---

## 19. "Where adapter conformance lives" generalizes beyond storage

**Surfaced by:** v4-04 RETRO §6 #3. Current testing.md phrases everything as "the adapter implements `ItemRepository`." One-line addition: "The same rule applies to any capability ABC — conformance tests in `tests/unit/adapters/`, integration stays adapter-agnostic via a Fake, smoke/e2e swap through the real uvicorn subprocess."

**Size:** one or two sentences.

**Merges with:** #18.

---

## 20. Dependency policy for adapters

**Surfaced by:** v4-04 RETRO §6 #4 + v4-02's deliberate avoidance of pyjwt/passlib. Two agents, two readings of the same implicit rule. v4-04 proposes: *"Adapters can pull their runtime deps into main; keep them listed next to `fastapi`/`uvicorn`; don't introduce framework stuff the domain/service layers could accidentally import."*

**Size:** one-liner in CLAUDE.md "Backend architecture" section.

---

## 21. Integration test body-equality assertion fragility

**Surfaced by:** v4-04 LOG §6. When `ItemResponse` grew optional fields, four existing `assert body == payload` tests broke. Robust pattern: key-specific assertions.

**Probably overfit.** See discussion below.

---

## 22. `domain/repository.py` naming convention

**Surfaced by:** v4-04 RETRO §6 #5 + LOG §4. Agent considered folding `PriceSource` into `repository.py` and rejected it because the name is storage-specific. Their proposal: one file per capability ABC in `domain/`, consider `domain/ports/` subdirectory only if 3+ capability ABCs appear.

**Size:** one paragraph in architecture.md.

**Merges with:** #17.

---

## Revisit checklist

When v4-02 v2 closes and v4-03 + v4-04 manual tests are done, walk through this file top-to-bottom and for each item:

1. Still relevant? (Some may be obsoleted by experiment findings.)
2. Action: land / defer further / delete
3. If land: add to follow-up commit batch
4. If defer: note what signal we're waiting for

Goal: leave this file empty (or with only genuinely-deferred items) after one cleanup pass.
