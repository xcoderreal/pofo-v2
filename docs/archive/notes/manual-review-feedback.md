# Manual review feedback (2026-04-11)

User reviewed the Category + TanStack Query + multi-screen skeleton upgrade manually in browser. Items below pending discussion after "end."

## 1. Hooks/components: shared global vs nested per-screen?

Tripest (and some other repos) nest hooks/components inside each screen folder. Current skeleton uses a shared global `hooks/` and `components/` at the app root. What are the trade-offs? Which is best for long-term maintainability + testability?

## 2. Frontend integration tests for API usage?

Do we have integration tests on the frontend that verify API call correctness (not just Playwright e2e)? E.g., testing that `useItems()` calls the right endpoint with the right params, handles errors, invalidates cache on mutation.

## 3. Frontend test parallelism?

Are frontend tests still independent and runnable in parallel? Or does TanStack Query's shared QueryClient introduce state leakage between tests?

## 4. Multi-action Playwright tests — cost?

Is it expensive to add Playwright tests that do more than one action (e.g., create category → create item in category → verify item shows category → delete item)? Or should each test stay single-action?

## 5. `just install` required before `just dev` (resolved)

Error: 500 + MIME type refusal when running `just dev` without `just install` first. Resolved by running `just install`. Note for docs: `just dev` assumes deps are installed — document this in bootstrap.md or CLAUDE.md.

## 6. Placeholder text color too dark

Screenshot shows form inputs where placeholder text ("Item name", "Optional description", "tag1, tag2") is the same weight/color as real text. Should use a fainter color (e.g., `#999` or `placeholderTextColor` prop).

## 7. Cross-platform component library?

Any recommended component library to plug in across web + iOS? The skeleton currently uses raw StyleSheet. For medium-to-complex apps, is there a good cross-platform UI kit that doesn't fight Expo?

## 8. Categories page has no "create" flow

Frontend shows "No categories yet" with no way to create one from the UI. Need an "Add Category" button or form on the categories screen. Currently categories can only be created via API.

## 9. Component explorer (Storybook-like)

Need a way to explore components in isolation during development. User has set up something similar in tripest or another repo that works for both web + mobile. Could be a simplified version — doesn't need full Storybook.

## 11. No unit tests for domain models?

Current `domain/model.py` has `Item`, `Category` as plain dataclasses with no behavior. No tests exist for them. For the current skeleton this is fine (they're just data containers). But when pofo v2 adds FIFO lot matching, capital gains computation, and other domain logic — should there be domain-level unit tests? At what point does domain complexity warrant its own test file (`tests/unit/domain/test_model.py`)?

Reference: tripest uses semantic `NewType` aliases (`MinutesOffset`, `FareAmount`) and pure domain functions that are heavily unit-tested. Pitch-lab has frozen Pydantic models with operator overloads (`Rational.__add__`, `Pitch.__eq__`, `Key.scale_pitch_classes()`) — these absolutely need tests. The question is: should the skeleton's domain models demonstrate any of this (serialization, conversion, validation) even in the simple Item+Category case, so agents have a pattern to copy?

## 10. Tech stack diagram + package catalog

List all technologies (Expo, TanStack Query, Pydantic, openapi-typescript, Playwright, etc.) organized by concern (frontend, backend, testing, codegen, deployment). Add ASCII art showing how they connect e2e. Possibly a new "Implementation stack" section in architecture.md, orthogonal to the layering/abstraction sections.
