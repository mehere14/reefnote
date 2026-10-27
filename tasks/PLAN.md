# Novel Studio build tracker

Source of truth: ../SPEC.md; visual reference: ../novel-studio.html.

## Coordination
The orchestrator owns project setup, integration, acceptance testing, and this overview.
Each agent owns its task file and records implementation, checks, and outstanding gaps.
Do not edit another agent's owned files without coordinating.

| Workstream | Owner | Status | Record |
|---|---|---|---|
| SvelteKit setup and integration | Orchestrator | Complete | integration.md |
| SQLite, writing API, history, long prose | Core agent | Complete | core.md |
| Responsive interface and prototype fidelity | UI agent | Complete | ui.md |
| Providers, two-pass suggestions, checks | AI agent | Complete | ai.md |
| End-to-end acceptance and scale tests | Orchestrator | Complete with verification limits | integration.md |

## Shared contracts
- TypeScript SvelteKit + Svelte 5 (legacy syntax allowed), adapter-node, better-sqlite3, zod, ulid.
- API URLs and JSON request bodies follow SPEC section 6. DB snake_case fields are returned unchanged except JSON columns parsed to objects/arrays.
- GET /api/cards/:id returns {card, children, ancestors}; prose returns {text, rev, word_count, total, next}; chapter read returns {scenes:[{sceneId,title,prose}], next}.
- Core owns src/lib/server/db/**, src/lib/server/core.ts and src/routes/api/[...path]/+server.ts. Catch-all dispatcher delegates unhandled AI paths to handleAI(event): Promise<Response | null> from $lib/server/ai/api.
- AI owns src/lib/server/ai/**, checks/**, queue.ts, crypto.ts. Uses db default export from $lib/server/db and core named exports if coordinated. DB is better-sqlite3 Database; tables exactly SPEC section 3.
- UI owns src/routes/+layout.svelte, +page.svelte, n/**, src/lib/components/**, src/lib/styles.css and client helpers. Use API via fetch, no server imports.
- Orchestrator owns package.json/config, hooks, tests/integration, README and shared project configuration.
- Agents write their own tests; report dependency needs rather than editing package.json.
