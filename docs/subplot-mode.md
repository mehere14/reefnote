# Subplot mode

Open **Plots** from the book navigation. Subplots use the same workspace as chapters, characters, and world cards: contents on the left, the selected card in the middle, and co-writer chat on the right. A novel can use subplots and chapters together. Elements are the existing scene records: adding an existing scene to a subplot preserves its chapter placement and prose. Chapterless elements stay outside manuscript exports until chapter assembly is added.

Existing plot notes migrate verbatim into the premise. Empty identical copies from repeated development actions are hidden from the listing, with their original records and old links preserved. There is one plot editor and no separate Notes field.

Approve the premise, then use **Add scene** beside the scene list. Each scene opens **Plan** and **Prose** tabs. Write directly in Prose or approve the plan and choose **Draft scene with AI**. Turning points are optional and collapsed by default. Approve each spec before generating prose. AI drafts appear in Proposals, where they can be edited before acceptance. Approving prose creates a rolling summary and opens card extraction proposals. Extraction never changes entity cards until confirmed.

Cards retain the existing names, aliases, body editor, and history. **Appears in** distinguishes on-stage and referenced mentions. Saving an entity’s body opens its impact view when appearances exist. Choose elements and propose rewrites; on-stage appearances start selected. Review summary and passage diffs, accepting or rejecting hunks individually or by element. Manual prose edits remain available; conflicting proposals fail without overwriting text. Resolve pending changes before creating another set on the same elements.

Change history includes rollback. Rollback checks all accepted passages before restoring any of them. Changed passages stop the operation. Interrupted, failed, or cancelled rewrite runs preserve completed hunks and offer explicit retry for unfinished work.

Context logs show the exact assembled request, model, result, and status for each subplot AI call. They include only the target element’s full prose. Other elements contribute summaries, specs, and the previous ending. Full on-stage card bodies are preserved even when they exceed the nominal card budget; the log records that overflow.

Turning-point deletion preserves its elements directly under the premise. Upstream edits and reordering add review badges; **Still fine** clears them without rewriting content. Ripple checks also add review reasons and never edit prose.

## Verification

- `npm test`: existing regression suite and the Engineer’s Betrayal fixture, context isolation, extraction, concurrency, partial acceptance, rollback, cancellation, retry, and legacy migration tests.
- `npm run check` and `npm run build`.
- `node scripts/smoke-unified.mjs` (also available through `smoke-subplots.mjs`): unified desktop and phone browser verification against an isolated test server at `http://127.0.0.1:4318` (override with `REEFNOTE_TEST_URL`). Do not point smoke tests at the live writing database.
