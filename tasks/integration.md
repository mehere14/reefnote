# Integration
Status: Working v1 build delivered locally

- [x] Inspect specification and interactive prototype
- [x] Coordinate three Sol 6.1 agents with shared file ownership and API contracts
- [x] Scaffold SvelteKit + Node adapter and install dependencies
- [x] Integrate SQLite, writing UI, AI pipeline, continuity checks, and background jobs
- [x] Type/Svelte check: 0 errors, 0 warnings
- [x] Automated suite: 44 tests across 8 files
- [x] Production build and npm start on http://127.0.0.1:4317
- [x] Browser: new novel + premise, chapter/scene creation, rapid chapter edits, prose autosave during navigation, reader, rename/history restore, settings, desktop/mobile tabs
- [x] API/core: 3 chapters × 3 scenes × 3 beats; 90,000-word prose PATCH and lossless reader pagination; revision conflicts; invalid hierarchy; transaction rollback
- [x] AI HTTP: mocked provider SSE/JSON lifecycle, verbatim accept, repeat rejection filter, retry structuring, key encryption/redaction, error mapping
- [x] Password-protected production HTTP smoke: denied API, wrong password, session cookie, authenticated request, foreign-origin mutation rejection
- [x] Fixes from integration: serialized chapter-field writes, active drafts, atomic scene split, local ORIGIN default, login Set-Cookie, stream cancellation controls
- [x] README and saved desktop screenshot

## Evidence and limits

`npm run check`, `npm test`, `npm run build` pass under Node 24.19.0. Dependencies audited with no reported vulnerabilities after test-runner/cookie patches. Existing system shell Node 18 is too old: use Node 20.19+ (22/24 recommended).

Real provider calls require the user's selected provider/key/models; tests use mocked provider requests and incur no model charges. The spec's strict 200ms UI-stall ceiling has not been instrumented; long-text correctness is tested at 90,000 words. Optional manuscript export and optional check_runs logging are not implemented. Full subtype suggestion lists and chip-specific message styling remain polish items; custom subtype entry and all flow triggers work.

The browser-created sample novel “The Last Lighthouse” is local demo/test data in the ignored SQLite database, not a seeded library for new installs. Production app is left running on port 4317; temporary preview/auth servers were stopped.
