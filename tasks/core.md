# Core workstream

- [x] SQLite schema, boot pragmas, idempotent schema application
- [x] Novels/card CRUD and validated nesting
- [x] Fractional ordering, reparenting, cycle/cross-novel rejection
- [x] Manual links with same-novel validation
- [x] gzip versions, restoration, revisions and FTS synchronization
- [x] Prose optimistic concurrency and validated range patches
- [x] Paged prose/chapter reader
- [x] API catch-all routes and AI delegation
- [x] Functional tests and integration type checks (17 tests pass; no core TypeScript errors)
- [x] Large scene snapshot diffs and typing snapshot cadence

Mutations exported to AI accept handler; all changes transactional. >200k-character snapshots use diff-match-patch deltas with full checkpoints every 20 versions. Prose debounce typing sessions snapshot baseline and every 5 minutes; blur closes the session. Reader chunks within very large scenes and preserves every character. Card edits schedule digest/check jobs.

Validation: Node24 + Vitest4: 17 tests passed, including HTTP API, conflicts, versions/links restore, hierarchy/cycles, 3×3×3 content, 90k-word PATCH + reader exact reconstruction. Core/API tests passed in 155ms combined; independent AI review tests passed in 24ms. Review found invalid parent/prose proposals and missing fresh prior-chapter context; AI agent fixed them and regression tests pass.

## Additional integration verification

- [x] Real HTTP routes + provider adapter exercised with mocked fetch SSE fragments (no live keys/costs): pass 1 + pass 2, verbatim acceptance, repeated rejection filtering, encrypted settings, permissions on secret file, omitted public secrets, missing provider, provider 401, structure-only retries. Six tests in tests/ai-api-integration.test.ts.
- [x] Atomic POST /api/cards/:id/split with optimistic prose rev, fractional sibling ordering, latest-prose history snapshot, and rollback on conflicts. HTTP test verifies no duplicate scenes after rejected concurrent split and restores original prose.
