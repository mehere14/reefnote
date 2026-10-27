# UI workstream

Owner: UI agent (Sol 6.1). Source: SPEC.md; visual reference: novel-studio.html.

| Task | Status | Evidence |
|---|---|---|
| Three-column paper / index-card shell, self-hosted Newsreader / Manrope | Implemented | Prototype CSS ported, theme switch and responsive tabs |
| Empty library, novel create/edit/delete/switch and last-open state | Implemented | JSON API wired; no mock data |
| Real section/card URLs and ancestor breadcrumbs | Implemented | Svelte routes + shared Studio |
| Every card type, free text, chapter hooks and trap/escape fields | Implemented | Blur saves with baseRev; custom subtype/aliases dialog |
| Chapter/scene/beat nesting and sibling reorder | Implemented | create parentId / move APIs |
| Links picker, both directions, chapter descendant threads | Implemented | Manual labels; delete link; link navigation |
| Version list + confirmed restore | Implemented | History and restore API |
| Co-writer composer + every flow chip | Implemented | SSE text/phase/progress/suggestions/done/error handlers |
| Suggestions accept/edit/dismiss and force stale replacement | Implemented | Local stale card explains conflict, Apply anyway sends force:true |
| Settings providers, secret input, model suggestions, test, advanced | Implemented | No key read from API; input+datalist permits arbitrary models |
| CodeMirror prose, full paged load, long-doc PATCH, save queue | Implemented | 600ms debounce, blur closes version session, dirty navigation waits save |
| Long scene split and dismissible hint | Implemented | New sibling scene + tail prose, truncates original after create/save |
| Lazy chapter manuscript | Implemented | IntersectionObserver; continued chunks coalesce; content-visibility |
| Continuity checks UI | Implemented | flags view, checks/run, read-only Ask composer |
| Accessibility and dark/mobile | Implemented | Focus rings, dialog focus trap, labels, reduced-motion CSS |
| Context-used line | Implemented | SSE context event and latest saved turn manifest |
| Type and component diagnostics | Passed (UI files) | npm run check: zero errors and warnings across project |
| Live browser workflow and visual review | Pending orchestrator | Root runs browser acceptance against integrated API |

Notes: Root owns integration tests and browser QA. Need validate typed prose + immediate navigation, stale replacement force path, multi-page single-scene reader, settings invalid provider response, and descendant badges. Core agent added descendant pending counts; child rows now show badges. Settings omits an empty baseUrl to satisfy URL validation.

## Browser QA fixes
- Rapid chapter field saves now use a per-card mutation queue. Each queued operation reads the latest revision and merges only its changed named field. Requests capture the card ID before navigation.
- Draft values stay separate from server state. Completing a save clears only exact submitted drafts, preserving focused unsaved fields and newer typing.
- tests/ui.test.ts: rapid three-field saves/revision sequence, failed save recovery and card isolation, focused/newer draft preservation.
- Free card conversation now uses card_chat so the co-writer can propose updates.
- Split at cursor now flushes prose then calls atomic core split endpoint with baseRev. The editor freezes during the operation; failures keep the original document. Backend guarantees no partial split.
