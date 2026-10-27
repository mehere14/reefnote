# AI and checks workstream

- [x] AES-256-GCM settings encryption and redacted settings API.
- [x] Thin streaming adapters: OpenAI, Anthropic, Google, OpenRouter, Ollama, OpenAI-compatible; model list and test APIs.
- [x] Two-pass turns with SSE writing/structuring/suggestion/completion and cancellation.
- [x] Markdown section and bold anchor extraction copies pass-one text verbatim.
- [x] Action permissions, ID/parent validation, duplicate/rejection filtering and simhash fingerprints.
- [x] Transactional suggestion accept/reject/batch; stale replacements and explicit force.
- [x] Context budget, manifest, recipes, linked cast, prior scene ending, candidates and FTS Ask retrieval.
- [x] Sequential debounced background queue with retry, factual lazy digests.
- [x] Long scene drafting by beat and continuity chunk map/reduce with three workers and progress.
- [x] Deterministic checks and rejection memory.
- [x] 13 AI tests pass with mock provider; npm check passes 0 errors/warnings; tests/ai.test.ts covers mock provider, text integrity, acceptance, stale/force, redaction, chunk scale and checks.

Integration: handleAI(event) at src/lib/server/ai/api.ts. queue.ts exports startQueue/enqueue/registerJob. Core mutation metadata {source:'suggestion', suggestionId, note}; uses createCard/updateCard/saveProse/createLink. No live provider keys configured.

Validation additions: explicit P0–P3 recipes, centered Ask retrieval, prior chapter and same-chapter context, scene-specific cast for chapter map checks, prose alias FTS candidates and rejected pair exclusion, bounded structuring index, scope validation, final SSE buffering, provider key redaction and modern OpenAI reasoning request profile. Tests cover these cases using provider mocks. Live provider credentials are not available, so actual provider calls remain unverified.
