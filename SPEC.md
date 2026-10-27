# Reefnote — Product & Technical Specification

Version 1.1 · Original reference prototype: `novel-studio.html` (the v1 mock; the shipped UI has since moved to the unified workspace and Reef design described in §4–§5).

This document is written for engineers and coding agents working on Reefnote. It is the source of truth. Where the prototype and this spec disagree, this spec wins. Reefnote was called "Novel Studio" during v1 development; some identifiers keep that name (`NOVEL_STUDIO_DB`, `NOVEL_STUDIO_PASSWORD`, the `novel-studio` package name, the `novel_session` cookie).

**What changed since v1.0:** Reefnote naming and the Reef design system (§4); the unified workspace with a Settings page (§5); Voice & Style (§15); plot-first subplot mode (§16); multiple chats, the chat archive, and pinned responses (§17); EPUB/PDF/Markdown manuscript export (§18); and the corresponding schema (§3) and API (§6) additions.

---

## 0. What we're building

Reefnote is an open-source, self-hosted writing tool for novelists. A writer develops a novel as a set of linked **cards** (premise, outline, characters, arcs, world, style, plots, chapters → scenes → beats) and works with an AI **co-writer** that brainstorms, fleshes out, drafts, and checks continuity.

### Non-negotiable principles

1. **Flexible, not rigid.** No required fields, no required order. Structure is offered, never enforced.
2. **Plain text first.** Cards are mostly free text. Dates, backstory, and events live in prose, not in form fields. Only a few card types have named text fields (chapter hooks, trap-and-escape parts), and those are still free text.
3. **The AI never writes directly.** Every AI change becomes a **suggestion** the writer accepts, edits, or dismisses. This includes links: linking is never automatic.
4. **Write first, structure second.** AI output is generated in two passes: a rich free-text pass, then a separate structuring pass that converts it into suggestions. Card text is copied verbatim from pass 1, never re-summarised by pass 2.
5. **Everything is reversible.** Every change creates a version. Any version can be restored.
6. **Clone and go.** `git clone`, `npm install`, `npm start`, open the browser, enter a provider + key + model in Settings, start writing. SQLite, no external services.
7. **No size ceiling that breaks features.** A 300-page chapter must work for editing, reading, drafting, and continuity checks (see §9).

---

## 1. Tech stack and repo layout

One SvelteKit app serves both the UI and the API from a single Node process. No separate server, no workspaces.

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 20+ | Long-running process (required for SQLite) |
| App framework | SvelteKit (TypeScript) with `@sveltejs/adapter-node` | UI + server routes in one project, one build, one process |
| Database | SQLite via `better-sqlite3` | Synchronous, fast, zero setup, single file |
| Validation | `zod` | Request validation and AI structured-output validation |
| AI providers | Thin in-house adapter over `fetch` (§10); no provider SDKs | Uniform streaming + JSON output across providers |
| Client state | Component state in `Studio.svelte` + typed fetch helpers (`lib/api.ts`) | No extra state libraries |
| Editor | Markdown fields (rendered preview, click or **Edit** to open a `<textarea>`) for card text; CodeMirror 6 for scene prose | CodeMirror handles very long documents with virtualised rendering |
| Rendering | `markdown-it` for card text and chat responses | Safe Markdown rendering of notes and AI output |
| Export | `pdfkit` (PDF), `fflate` (EPUB zip and style-library zip) | Manuscript export (§18) |
| Diffing | `diff-match-patch` | Long-prose version diffs and subplot rewrite hunks |

Do **not** use serverless adapters (Vercel, Netlify, Cloudflare). SQLite and the background queue need a persistent process.

```
reefnote/
  package.json              # dev / build / start / remote / check / test
  svelte.config.js          # adapter-node
  config/
    tailscale.example.json  # template for the optional private remote launcher
  scripts/
    start.mjs               # production entry: sets HOST/PORT/ORIGIN defaults, refuses public bind without a password
    remote.mjs              # optional: build + private Tailscale Serve + caffeinate (macOS)
    smoke-*.mjs             # Playwright browser smoke tests against a disposable server
  src/
    hooks.server.ts         # opens DB, runs migrations, creates secret.key, starts queue, password auth, origin check
    lib/
      server/               # server-only code (never imported by client)
        db/
          schema.sql        # core DDL from §3
          index.ts          # singleton connection, pragmas, idempotent migrations (style, chats, pins)
          subplot-schema.ts # subplot tables (§3, §16)
          plot-migration.ts # migrates legacy plot cards into subplots (§16)
        core.ts             # cards, prose, links, versions, ordering, scene split, POV/style links
        manuscript.ts       # EPUB / PDF / Markdown export (§18)
        ai/
          providers/        # adapter + model context-window table (§10)
          context/          # context assembly (§7)
          flows/            # per-flow instructions (§8)
          prompts.ts        # editable prompts; defaults in prompt-defaults.ts (§8.4)
          structure.ts      # pass 2 + validation + suggestion creation
          convert.ts        # pass-2 conversion call
          chapter-draft.ts  # Draft chapter flow (§8.2)
          chats.ts          # chat creation and lookup (§17)
          settings.ts       # provider config, key encryption
          tokens.ts         # token estimation, prose chunking
          api.ts            # AI, chat, pin, suggestion, and settings endpoints
        style/              # style library, resolution, endpoints (§15)
        subplots/           # subplot service, generation, mention indexing, review/rollback, endpoints (§16)
        checks/             # deterministic rule checks (§11)
        security/session.ts # password check + signed session cookie
        queue.ts            # in-process job queue (§1.1)
        crypto.ts           # key encryption (§10.3)
      style-library/        # built-in style entries as Markdown (§15)
      components/           # Studio (workspace shell), ProseEditor, Markdown, MarkdownField,
                            # CardAppearances, StyleControls, StyleLibrary, SubplotEditor
      api.ts                # typed fetch helpers for /api routes
      styles.css            # design tokens and global styles (§4)
    routes/
      +layout.svelte        # fonts, global styles, theme
      +page.svelte          # library / opens last novel
      settings/+page.svelte # Settings page (§5.8)
      n/[novelId]/[section]/+page.svelte           # section view in the workspace
      n/[novelId]/[section]/[cardId]/+page.svelte  # card detail (and ?read=1 for chapter reader)
      n/[novelId]/subplots/+page.svelte            # subplot mode (§16)
      n/[novelId]/archive/+page.svelte             # chat archive (§17)
      api/[...path]/+server.ts  # single catch-all dispatching to core, style, subplot, and AI handlers (§6)
  data/                     # created on first run: novel.db, secret.key, style-library/ (gitignored)
```

Fonts are installed from npm (`@fontsource-variable/literata`, `@fontsource-variable/figtree`, `@fontsource/newsreader` for PDF export) and bundled, so the app works offline.

Routes give every section and card a real URL (`/n/:novelId/chapters/:cardId`), so browser back/forward and bookmarks work.

### First run

1. `npm install && npm run build && npm start` (or `npm run dev` while developing).
2. On boot, `hooks.server.ts` creates `./data/novel.db` and `./data/secret.key` if missing, runs migrations, and starts the queue. The app listens on `http://127.0.0.1:4317`. Environment overrides: `HOST`, `PORT`, `ORIGIN` (required behind a proxy, per adapter-node), `NOVEL_STUDIO_DB` (database path), `DATA_DIR` (key directory), `NOVEL_STUDIO_PASSWORD` (enables sign-in), and `BODY_SIZE_LIMIT` (default `20M`).
3. Browser opens to an empty library with a single prompt: "Start a new novel". If no AI provider is configured, a quiet banner reads "Add an AI provider in Settings to use the co-writer." Everything except AI flows works without a provider.

### 1.1 Background queue

SvelteKit has no job runner, so `queue.ts` provides a tiny in-process one, started once from `hooks.server.ts`:

- `enqueue(kind, key, payload, delayMs)` with **dedupe by key** (re-enqueueing the same key resets the timer). This gives debouncing for free.
- Job kinds: `digest:<cardId>` (30s after last edit, §7.4), `checks:<novelId>` (2s after accepted changes, §11), `chapterDigest:<chapterId>`.
- Runs jobs sequentially with a concurrency of 1 for AI jobs (configurable). Failures log and retry once with backoff.
- Jobs are not persisted. On restart, stale digests are recomputed lazily when needed (`rev > digest_rev`), and checks run on next accepted change or on demand, so nothing is lost.

### 1.2 Server-only boundary

All DB, AI, key, and filesystem code lives under `src/lib/server/` so SvelteKit refuses to bundle it into the client. API keys never reach the browser.

---

## 2. Domain model

### 2.1 Novel

The top-level container. A user can have many novels and switch between them.

### 2.2 Card

Everything is a card. Every card has a **type**, an optional free-text **subtype**, a **title**, and text. Cards can nest (`parent_id`) and are ordered among siblings (`position`).

### 2.3 Card types, sections, and subtypes

The book has eight sections in this fixed order (`SECTIONS` in `core.ts`). Each section owns one or more top-level card types. The workspace lists them in the **Book sections** menu (§5.1).

| # | Section key | Section | Top-level types | Child types |
|---|---|---|---|---|
| 1 | `premise` | Premise | `premise` | — |
| 2 | `outline` | Outline | `outline` | — |
| 3 | `characters` | Characters | `character`, `group`, `relationship` | — |
| 4 | `arcs` | Character arcs | `arc` | — |
| 5 | `world` | World & rules | `setting`, `rule`, `object`, `event` | `setting` may nest (galaxy → planet → city) |
| 6 | `styles` | Voice & Style | `style` (subtype `book` or `preset`) | — |
| 7 | `plots` | Grand plot & subplots | `plot`, `secret`, `theme`, `question` | Plots are developed in subplot mode (§16) |
| 8 | `chapters` | Chapters | `chapter` | `scene` (child of chapter), `beat` (child of scene) |

Every novel has exactly one `style`/`book` card ("Book voice"), created automatically by a database trigger and protected from deletion (§15).

Subtypes are free text. The UI offers these suggestions but accepts anything:

- **premise:** one sentence
- **outline:** one paragraph, one page, act outline
- **character:** protagonist, antagonist, deuteragonist, mentor, ally, love interest, foil, rival, trickster, comic relief, minor
- **group:** family, household, faction, government, corporation, crew, religion, species, secret society
- **relationship:** siblings, parent/child, mentor/student, rivals, lovers, allies, enemies
- **arc:** change arc, flat arc, fall arc, redemption arc, relationship arc
- **setting:** universe, galaxy, planet, moon, station, ship, city, region, building, household, workplace, era, virtual space
- **rule:** technology, travel, communication, magic/power, biology, economy, law, social custom, history/lore, language
- **object:** artifact, weapon, vehicle, device, document, clue, heirloom, MacGuffin
- **event:** history, backstory, off-page event
- **plot:** grand plot, subplot, mystery thread, romance thread, rivalry thread
- **secret / theme / question:** free
- **chapter:** standard, prologue, epilogue, interlude, flashback (plus "chapter N" labels)
- **scene:** action, dialogue, discovery, chase, reflection, flashback, montage
- **beat (fixed list, plus custom):** setup, payoff, reveal, reversal, trap-and-escape, confrontation, decision, betrayal, loss, reunion, breather, cliffhanger

### 2.4 Text fields per type

All fields are free text. Every type has `body`. Some types add named fields stored in `fields` (JSON object of strings):

| Type | Fields shown in UI | Storage |
|---|---|---|
| all except chapter | Notes / plan (`body`, Markdown) | `cards.body` |
| chapter | Purpose, Opens on, Closes on; Style notes | `fields.purpose`, `fields.opens`, `fields.closes`, `fields.styleNotes` (body unused, hidden) |
| scene | Scene plan (`body`) + Prose; Style notes and preset mode | `cards.body` + `scene_prose` table; `fields.styleNotes`, `fields.stylePresetMode` (§15) |
| character | Notes, including a `## Voice` section with `### Dialogue` and `### Interior` | `cards.body` (parsed for style, §15) |
| style | Voice or preset guidance | `cards.body` |
| beat, subtype `trap-and-escape` | The corner, Exits that fail, The unexpected way out | `fields.corner`, `fields.fails`, `fields.way` |
| beat, other subtypes | What happens (`body`) | `cards.body` |

Changing a beat's subtype away from `trap-and-escape` keeps its `fields` (hidden, restored if switched back).

### 2.5 Links

A directed, labelled connection between two cards. Labels are free text. Some labels have meaning to the app:

| Label | From → To | Meaning in the UI |
|---|---|---|
| `POV`, `present`, `set in`, `features` | scene → character/group/setting/object | "In this scene" tags |
| `opens`, `advances`, `resolves`, `explores` | scene or chapter → plot/secret/theme/question | Threads; colour-coded labels |
| `pays off` | beat → beat | Setup/payoff pair |
| `uses` | beat → object | Shown as a tag on the beat |
| `arc of` | arc → character | Arc ownership |
| `between` | relationship → character (×2) | Relationship members |
| `uses_style` | chapter or scene → style preset | The preset that styles it (§15) |
| anything else | any → any | Generic link |

`THREAD_LABELS = [opens, advances, resolves, explores]`, `CAST_LABELS = [POV, present, set in, features]`.

Database constraints: a scene has at most one `POV` link and it must target a character; a chapter or scene has at most one `uses_style` link and it must target a `style`/`preset` card. A trigger rejects invalid `POV` and `uses_style` links.

### 2.6 Suggestions

Proposed changes from the AI. Actions: `create_card`, `update_card`, `add_link`, `set_link` (replaces a single-valued `POV` or `uses_style` link), `flag_issue`. Each carries a short `what` (headline), `why` (reason), optional `preview` text, and a payload. Lifecycle: `pending → accepted | rejected | stale` (§8.6).

### 2.7 Chats and messages

Each novel has conversations per **scope**. Scope is a section key (`premise`, `outline`, `characters`, `arcs`, `world`, `styles`, `plots`, `chapters`, `flags`), a card id, or a subplot id. A scope has at most one **active chat** at a time; starting a new chat archives the previous one (§17). Messages store the user's text and the AI's pass-1 response and belong to a chat.

### 2.8 Versions

Snapshots of a card (and scene prose) taken before every change. Restorable.

---

## 3. Database schema (SQLite)

Run with `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;`.

```sql
CREATE TABLE novels (
  id            TEXT PRIMARY KEY,            -- ulid
  title         TEXT NOT NULL,
  tagline       TEXT NOT NULL DEFAULT 'a novel in progress',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_opened_at INTEGER
);

CREATE TABLE cards (
  id          TEXT PRIMARY KEY,               -- ulid
  novel_id    TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                  -- see §2.3
  subtype     TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL,
  aliases     TEXT NOT NULL DEFAULT '[]',     -- JSON array of strings ("the Admiral", "Steve")
  body        TEXT NOT NULL DEFAULT '',
  fields      TEXT NOT NULL DEFAULT '{}',     -- JSON object of string fields (§2.4)
  parent_id   TEXT REFERENCES cards(id) ON DELETE CASCADE,
  position    REAL NOT NULL DEFAULT 0,        -- fractional ordering among siblings
  digest      TEXT NOT NULL DEFAULT '',       -- AI-written short summary for context (§7.4)
  digest_rev  INTEGER NOT NULL DEFAULT 0,     -- rev the digest was computed at
  rev         INTEGER NOT NULL DEFAULT 1,     -- increments on every change
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX cards_novel_type ON cards(novel_id, type);
CREATE INDEX cards_parent ON cards(parent_id, position);

-- Prose lives apart from cards so card lists never load it.
-- One row per scene; a scene's prose can be arbitrarily long.
CREATE TABLE scene_prose (
  scene_id    TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  text        TEXT NOT NULL DEFAULT '',
  word_count  INTEGER NOT NULL DEFAULT 0,
  rev         INTEGER NOT NULL DEFAULT 1,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE links (
  id          TEXT PRIMARY KEY,
  novel_id    TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  from_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  to_id       TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  label       TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  UNIQUE(from_id, to_id, label)
);
CREATE INDEX links_from ON links(from_id);
CREATE INDEX links_to ON links(to_id);

CREATE TABLE versions (
  id          TEXT PRIMARY KEY,
  card_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  note        TEXT NOT NULL,                  -- "Renamed", "Co-writer addition accepted", ...
  snapshot    BLOB NOT NULL,                  -- gzip(JSON {title, subtype, body, fields, aliases, prose?})
  source      TEXT NOT NULL,                  -- 'user' | 'suggestion' | 'restore'
  suggestion_id TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX versions_card ON versions(card_id, created_at DESC);

CREATE TABLE turns (
  id          TEXT PRIMARY KEY,               -- one AI request (pass 1 + pass 2)
  novel_id    TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL,                  -- section key or card id
  flow        TEXT NOT NULL,                  -- see §8.2
  status      TEXT NOT NULL,                  -- 'writing' | 'structuring' | 'done' | 'error'
  error       TEXT,
  context_manifest TEXT NOT NULL DEFAULT '[]',-- JSON list of {card_id, form, tokens} actually sent (§7.6)
  model_write TEXT, model_struct TEXT,
  tokens_in   INTEGER, tokens_out INTEGER,
  created_at  INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE messages (
  id          TEXT PRIMARY KEY,
  novel_id    TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL,
  role        TEXT NOT NULL,                  -- 'user' | 'assistant'
  text        TEXT NOT NULL,                  -- assistant: pass-1 markdown
  turn_id     TEXT REFERENCES turns(id),
  created_at  INTEGER NOT NULL
);
CREATE INDEX messages_scope ON messages(novel_id, scope, created_at);

CREATE TABLE suggestions (
  id          TEXT PRIMARY KEY,
  novel_id    TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  turn_id     TEXT REFERENCES turns(id),      -- null for rule-check flags
  origin      TEXT NOT NULL,                  -- 'ai' | 'rule'
  scope       TEXT NOT NULL,                  -- where it was raised (section key or card id)
  target_card_id TEXT REFERENCES cards(id) ON DELETE CASCADE, -- null for create_card
  base_rev    INTEGER,                        -- target card rev when suggested
  action      TEXT NOT NULL,                  -- create_card | update_card | add_link | flag_issue
  payload     TEXT NOT NULL,                  -- JSON, shape per action (§8.5)
  what        TEXT NOT NULL,
  why         TEXT NOT NULL DEFAULT '',
  preview     TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL,                  -- for rejection memory (§8.7)
  status      TEXT NOT NULL DEFAULT 'pending',-- pending | accepted | rejected | stale
  resolved_at INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX sugg_pending ON suggestions(novel_id, status);
CREATE INDEX sugg_target ON suggestions(target_card_id, status);

CREATE TABLE rejections (
  novel_id    TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  what        TEXT NOT NULL,                  -- human-readable, also fed to prompts
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (novel_id, fingerprint)
);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL                   -- JSON; secrets stored encrypted (§10.3)
);

-- Full-text search over cards and prose (used for mention detection and Ask)
CREATE VIRTUAL TABLE fts USING fts5(card_id UNINDEXED, novel_id UNINDEXED, kind UNINDEXED, text, tokenize='porter unicode61');
```

Keep `fts` in sync with triggers or in the repository layer on every write to `cards` and `scene_prose`. For prose, index per scene (one row per scene).

### 3.1 Additions since v1.0

`schema.sql` holds the tables above plus `llm_requests`. Everything else is added by idempotent migrations in `db/index.ts`, `db/subplot-schema.ts`, and `db/plot-migration.ts`, which run on every boot (`CREATE … IF NOT EXISTS`, and `ALTER TABLE … ADD COLUMN` only when the column is missing).

```sql
-- Provider call log, shown in Settings → LLM request log (last 200)
CREATE TABLE llm_requests (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL,
  started_at INTEGER NOT NULL, latency_ms INTEGER NOT NULL,
  tokens_in INTEGER, tokens_out INTEGER, status TEXT NOT NULL
);

-- Extra turn columns
ALTER TABLE turns ADD COLUMN include_card_context INTEGER NOT NULL DEFAULT 1; -- "Send card context"
ALTER TABLE turns ADD COLUMN only_current_card INTEGER NOT NULL DEFAULT 0;    -- "Send only current card"
ALTER TABLE turns ADD COLUMN style_context TEXT NOT NULL DEFAULT '[]';        -- style layers actually sent (§15)
ALTER TABLE turns ADD COLUMN style_exclusions TEXT NOT NULL DEFAULT '[]';     -- layer ids excluded for this send
ALTER TABLE turns ADD COLUMN chat_id TEXT;
ALTER TABLE messages ADD COLUMN chat_id TEXT;

-- Chats (§17). Card metadata is copied so archived chats survive card deletion.
CREATE TABLE chats (
  id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  scope TEXT NOT NULL, card_type TEXT NOT NULL, card_name TEXT NOT NULL,
  created_at INTEGER NOT NULL, archived_at INTEGER
);
CREATE UNIQUE INDEX chats_active ON chats(novel_id, scope) WHERE archived_at IS NULL;

CREATE TABLE pinned_messages (
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, PRIMARY KEY (novel_id, message_id)
);

-- Style invariants (§15)
CREATE UNIQUE INDEX one_book_style_per_novel ON cards(novel_id) WHERE type='style' AND subtype='book';
CREATE UNIQUE INDEX one_pov_per_scene ON links(from_id) WHERE label='POV';
CREATE UNIQUE INDEX one_style_per_card ON links(from_id) WHERE label='uses_style';
```

Triggers: `novel_book_style` (creates the Book voice card for each new novel), `validate_style_link` (rejects invalid `POV`/`uses_style` links), `cards_fts_delete`, and the chat triggers `chat_message_insert`, `chat_card_delete` (archives a deleted card's chat and keeps its name), and `chat_card_rename`.

Subplot mode (§16) adds these tables:

| Table | Purpose |
|---|---|
| `subplots` | A plot: title, premise, theme, start and end state, status (`draft`/`approved`), `rev` |
| `turning_points` | Ordered turning points of a subplot, with status and `review_reason` |
| `elements` | Subplot data for a scene card (keyed by `scene_id`): subplot, turning point, position, purpose, target length, time marker, rolling summary, status, prose state, version |
| `element_cards` | Cards in an element, role `on_stage` or `referenced`, optional secret action (`introduced`/`hinted`/`revealed`) |
| `mentions` | Indexed character offsets of card mentions in an element's prose |
| `element_links` | `depends_on` / `shares_scene_with` links between elements |
| `change_sets`, `change_hunks` | Proposed impact rewrites and their per-passage hunks (prose, summary, or spec) |
| `change_applications` | Before/after records of applied hunks, used for rollback |
| `subplot_jobs` | Payloads of rewrite runs, for retry |
| `subplot_requests` | Logged AI requests for subplot work: exact context, result, status |
| `extractions` | Pending card extraction proposals from approved prose |
| `subplot_proposals` | Pending AI proposals (premise, turning points, specs) |
| `plot_sources`, `plot_aliases` | Map legacy `plot` cards to subplots and hide empty duplicate plots |

On boot, any `subplot_requests` or `change_sets` left `running` are marked `interrupted` so the writer can retry them explicitly.

### Ordering

`position` is a REAL. Inserting between A and B uses `(A+B)/2`. Moving up/down swaps positions with the neighbour. When gaps fall below `1e-9`, renumber siblings `0,1,2…` in one transaction.

### Deletion

Deleting a card cascades to children, links, versions, and pending suggestions targeting it. The UI must confirm deletes that remove children ("Delete chapter and its 4 scenes?"). Deleted cards are not recoverable (consider soft delete later). The Book voice card cannot be deleted, only emptied. A deleted card's chat is archived with the card's last name and type.

---

## 4. Design system

### 4.1 Direction

"Reef": sea-glass paper, white card stock, deep ink, one deep-lagoon teal accent, and coral reserved for things that need the writer's attention (pending counts, suggestions, issues). Cards look like writer's **index cards**. The contents rail reads like a **table of contents**. The chapter reader is a **typeset manuscript page**. Avoid dashboard tropes: no coloured side borders on cards, no gradient washes, no all-caps labels, no per-type colour coding on cards. Containers that hold primary content (turning points, proposals, card text) are open by default; only settings and meta details collapse.

### 4.2 Tokens

All colours, radii, and shadows are CSS custom properties on `:root` in `src/lib/styles.css`. Components never hard-code hex values.

```
Light (default)
--page          #EAF0EE   app background (sea glass)
--paper         #FFFFFF   panels, cards, dialogs
--soft          #F2F6F5   chips, inputs, hover
--ink           #132A2C   primary text
--dim           #587070   secondary text
--line          #D3DFDB   borders, dividers, dotted leaders
--accent        #0E6964   primary buttons, links, active items (lagoon)
--accent-strong #0A524E   accent hover
--accent-soft   #DCEDEA   selected backgrounds, pressed chips
--accent-ink    #FFFFFF   text on accent
--rule          #BCD5D0   index-card title rule, block heading rule
--rule-blue     #DCEDEA   ruled lines behind snippets
--pending       #E5566A   counts of things waiting on the writer (coral)
--pending-on    #FFFFFF   text on pending
--pending-bg    #FCEBED   suggestion cards, issue banners
--pending-ink   #A3263A   text on pending-bg
--ok            #1F6E4A   Accept buttons, "resolves" label
--ok-soft       #DDEFE4
--danger        #B83A3A   destructive actions
--del-bg        #FBE0DC   diff deletions
--ins-bg        #DCF0E3   diff insertions
--scrim         rgba(10,32,34,.42)
--radius-s 7px   --radius 10px   --shadow / --shadow-lg (soft teal-tinted shadows)

Dark (prefers-color-scheme: dark, or data-theme="dark")
--page #0F1D1E  --paper #152627  --soft #1C2F30  --ink #E3EEEC  --dim #93ABA9  --line #2A4143
--accent #5CC2B8  --accent-strong #7DD3CA  --accent-soft #1A3A39  --accent-ink #08201F
--rule #2F4A4B  --rule-blue #22393A
--pending #F07A8A  --pending-on #2B0A10  --pending-bg #36222A  --pending-ink #F6A3AE
--ok #7CC49A  --ok-soft #1C3428  --danger #E58A7E  --del-bg #4A2622  --ins-bg #1F3A27
```

Thread label colours: `--lab-opens` `#2D6FA8`, `--lab-advances` `#6B4FBF`, resolves `--ok`, `--lab-explores` `#A86E10` (lighter variants in dark mode).

The theme follows the system setting. **Light / dark** in the rail footer sets `data-theme` on `<html>` to override it.

### 4.3 Typography

- **Literata** (`--serif`, variable) for everything that is story: novel title, section titles, card titles, card notes, prose, chat responses, block headings (italic), contents entries, descriptions.
- **Figtree** (`--ui`, variable) for interface controls: buttons, chips, tabs, small labels, counts, help text.
- **Newsreader** is used only inside exported PDFs (§18).
- Fonts are installed from npm (`@fontsource-variable/*`, `@fontsource/newsreader`) and bundled, so the app works offline.

### 4.4 Layout

The workspace is two columns on desktop: a **contents rail (240px)** and a **main area** split into the **editor** and the **co-writer chat** (default 420px, resizable with a drag handle). Either the rail or the chat can be collapsed from the toolbar. Suggestions, Links, History, and Style open in a **Details drawer** over the right edge. Between 961px and 1200px the rail narrows to 210px and the chat takes 35%. At 960px and below: one column with a bottom tab bar (**Story / Write / Details**).

### 4.5 Components

Buttons come in three weights: `.btn` (primary, at most one per view), `.chip` (secondary, used for AI actions), and `.plain` (text link).

- **Contents entry:** step number (serif, dim) · section name (serif) · dotted leader · count · coral pending badge. Active: accent-soft background, name italic in accent.
- **Index card:** white, 1px line border, `--radius`, soft shadow. Top row: italic subtype left, italic type right. Then a 1.5px `--rule` line. Title (serif, semibold). Snippet: 3 lines of rendered Markdown. Footer meta: child count, link count, coral pending badge. Hover: accent border.
- **Markdown field:** rendered Markdown preview; clicking the text (but not a link in it) or **Edit** opens a textarea at the same height. Saves on blur.
- **Block:** index-card panel used on detail pages; italic serif heading with a `--rule` line under it.
- **Editor tabs:** **Plan** / **Prose** segmented tabs on scenes.
- **Row:** a compact card with ↑/↓ reorder buttons (scenes and beats).
- **Tag:** pill with serif name and italic label (cast in a scene).
- **Thread line:** title button · coloured label pill · italic "in <scene>".
- **Suggestion card:** pending-bg; "On <card>" line when shown outside its card; headline (serif semibold), reason (small dim), preview, actions. For `flag_issue`: **Apply fix** + **It's intentional**. Otherwise: **Accept** (green) + **Dismiss**.
- **Diff review:** before/after columns with `--del-bg` and `--ins-bg` highlights (prose drafts and subplot rewrites).
- **Dialog:** paper, rule under the heading, italic lead line.
- **Toast:** ink background, paper text, bottom centre.

### 4.6 Copy rules

Sentence case. Plain verbs. Buttons say what they do ("Create novel", "Apply fix", "Read whole chapter"). Empty states invite action ("No scenes yet. Brainstorm some from the chapter plan."). Errors say what happened and how to fix it ("The provider rejected the API key. Check it in Settings.").

---

## 5. Screens and features

The shipped UI is one **workspace** (`Studio.svelte`): contents rail, editor, and co-writer chat side by side (§4.4), with a toolbar above the editor and a Details drawer.

### 5.1 Contents rail (left)

1. **Novel switcher.** The novel title is a button with a ▾. It opens a menu listing all novels (current one italic, "open now"; others show their tagline), a divider, **+ New novel**, and **Edit novel** (title and tagline). Selecting a novel opens its Chapters section. The last-opened novel opens on app start.
2. **New novel dialog.** Fields: Working title (default "Untitled novel"), Premise in a sentence (optional). **Create novel** creates the novel, its Book voice card, and, if a premise was given, a `premise` card.
3. **Contents.** On a section view, the eight sections (§2.3) in order with counts (Chapters shows scene count, "6 sc") and coral pending badges for all cards in the section, including descendants.
4. **Card navigator.** With a card open, the rail switches to: a **Book sections ▾** menu, "← All <section>", a selector to switch between top-level cards of that section, and an **Overview** entry. For a chapter: **Chapter overview**, a **Find a scene…** filter, the numbered scene list with ↑/↓ reorder buttons and pending badges, **+ Add scene**, and **Read chapter**. For other cards: their children plus **Linked cards**, **History**, and (character and style cards) **Voice & style**. In subplot mode the rail hosts the subplot navigator (§16).
5. **Continuity check** button: the count of pending `flag_issue` suggestions ("N issues to review" / "All clear"). Opens the Continuity view.
6. **Footer links:** **Chat archive** (§17), **Export** (§18), **Settings** (§5.8), and **Light / dark**.

### 5.2 Workspace toolbar and search

- Toggles: **Contents** (collapse the rail) and **Chat** (collapse the co-writer).
- Details tools: **Suggestions · N** always; **Links**, **History**, and **Style** when a card is open. Each opens the Details drawer on that tab. In subplot mode, **Review & history** opens subplot work (§16).
- **Search all cards…** searches titles, types, aliases, notes, fields, and scene prose across the novel and shows matching cards with a snippet. Esc clears.
- If no provider is configured, a banner reads "Add an AI provider in Settings to use the co-writer."

### 5.3 Main: section view

- Header: "Your story", section name, one-line description.
- Card grid. Multi-type sections are grouped with italic group headings (Characters / Groups / Relationships; Settings / Rules / Objects / Timeline events; Plots / Secrets / Themes / Open questions). Chapters are ordered by position and have ↑/↓ reorder buttons.
- **+ New card** tile (**+ New chapter**, **+ New preset**) opens a create dialog. Cards can also come from the co-writer (capture flow).
- **Plots** shows subplot cards with their status and **+ New plot**; opening one enters subplot mode (§16).
- **Voice & Style** shows the Book voice and presets, with **Suggest presets** and **Recommend a style** (§15).
- The co-writer chat is scoped to the section.

### 5.4 Main: card detail

Header: breadcrumb "← All <section>" then each ancestor (chapter / scene) as a link; editable title. Saves on blur. **Type & aliases** edits subtype and aliases; **Delete card** (hidden for the Book voice).

Scenes have **Plan** / **Prose** tabs. The Prose tab shows a style summary chip ("Style: Book voice + <preset> · POV: <name>") that opens the effective style in Details.

Body by type:

- **Premise / Outline / Character / Group / Relationship / Arc / Setting / Rule / Object / Event / Plot / Secret / Theme / Question**: **Notes** block with the `body` textarea and AI chips:
  - premise: *Expand to a paragraph*
  - outline: *Expand this*
  - character: *Flesh out backstory*, *Want vs. need*
  - arc: *Map the turning points*
  - plot: *Add complications*
  - others: *Flesh out*
  - all: *Suggest links*
  - For plot/secret/theme/question, an extra block **Where it shows up**: every scene/chapter linking to it with its thread label and chapter.
- **Chapter**:
  - **Chapter plan** block: *Purpose: what this chapter does*, *Opens on: the hook that pulls readers in*, *Closes on: the hook that makes them turn the page*. Chips: *Sharpen the hooks*, *Brainstorm scenes*, *Suggest threads*.
  - **Chapter notes**: planning text (`body`); manuscript text belongs in scene prose.
  - **Threads in this chapter**: all thread links from the chapter and its descendants, each with label and "in <scene>".
  - **Scenes**: listed in the rail navigator (§5.1). Chips: *+ Add scene*, *Draft chapter* (§8.2), *Read chapter*, *Check chapter continuity*.
  - **Read whole chapter** replaces the detail with a manuscript view: each scene's title centred in italic with an *Edit* link, prose typeset with indents; undrafted scenes show "Not drafted yet." A *← Back to chapter plan* chip returns.
- **Scene**:
  - **Scene plan** (`body`, typically goal / conflict / outcome). Chips: *Suggest beats*, *Strengthen the plan*.
  - **In this scene**: cast/setting/object tags from CAST_LABELS links. Chip: *Suggest who and where*.
  - **Threads this scene moves**. Chip: *Suggest threads*.
  - **Beats**: reorderable rows.
  - **Prose**: long-form editor. Chips: *Draft this scene*, *Write the dialogue*, *Check continuity*.
- **Beat**:
  - **Beat type**: pill toggle of the beat subtypes; choosing one updates the subtype (versioned).
  - If trap-and-escape: **Trap and escape** block with *The corner*, *Exits that fail*, *The unexpected way out*. Chips: *Brainstorm other escapes*, *Is the escape earned?*
  - Otherwise: **What happens** (`body`). Chip: *Sharpen this beat*.
  - **Setup and payoff**: `pays off` links in both directions ("pays off" / "paid off by"), plus `uses` tags. If the beat is a setup without a payoff: chip *Find a payoff*.

All text fields save on blur (debounced while typing for prose; see §9.3) and create a version. Scene prose is also saved before a manuscript export starts.

### 5.5 Main: continuity view

Header "Story issues". **Run story checks** runs the deterministic checks (§11). Grid of every card with a pending `flag_issue`; the Details drawer lists all flags. The chat here runs the **Ask** flow (read-only Q&A, e.g. "Where is Kira in chapter 2?").

### 5.6 Co-writer chat (right of the editor)

- **Co-writer** heading with the conversation's scope ("<card> conversation", "Scene chat") and the context line ("Context: Prologue + The missing keeper"). Buttons: **+ New chat** and **Chat archive** (§17).
- **Pinned reference** (§17): a selector over pinned responses, showing the chosen one above the thread.
- Thread of messages for the active chat. User messages right; AI messages as serif Markdown left.
- While a turn runs, the AI message streams pass-1 text ("Writing…"), then "Structuring into cards…", then "**N suggestions** ready for review" or "No card changes suggested". Chapter checks stream progress ("Checking 4 of 23 passages…").
- Under draft and dialogue responses: **Context used** (the manifest, §7.6) and **Style used for this response** (§15).
- Each AI response can be **Pinned** / **Unpinned**. On a scene, prose-like responses offer **Apply to scene…**, which opens a review (current text beside editable proposed text, destination scene and field selectors) and **Accept replacement**. The previous text stays in History.
- **Suggest cards** (with optional **Add instructions**) extracts card proposals from the whole chat, preferring the latest decisions (§17).
- **Chat context** (collapsed) controls what one send includes: **Send card context** (off = conversation only, no cards, style, or suggestions), **Send only current card**, and per-layer style exclusions.
- Composer: Enter sends, Shift+Enter newline. Placeholder reflects scope ("Brainstorm The missing keeper…").
- An AI chip on a card starts a turn in that card's chat; the chip label is stored as the user message.

### 5.7 Details drawer

- Opens over the right edge from the toolbar or rail. On mobile it is the **Details** tab.
- On a section: **Suggestions** only (all pending for cards in the section plus pending `create_card` suggestions raised there).
- On a card: **Suggestions** (for the card and its descendants), **Links** (both directions, label, click to open, add or remove), **History** (versions newest first, each with **Restore**), and **Style** (§15).
- Suggestions outside their own card show "On <card>". Accepting or dismissing updates counts everywhere immediately. Prose suggestions open the same review as **Apply to scene…**.

### 5.8 Settings page (`/settings`)

A full page with **← Back to Reefnote** (returns to the novel it was opened from). Panels, top to bottom:

- **Settings** ("Bring your own co-writer."):
  - **Provider**: Anthropic, OpenAI, Google Gemini, OpenRouter, Ollama (local), OpenAI-compatible.
  - **API key**: password input, labelled "(saved; leave blank to keep)" once a key exists; the key is never sent back to the browser. Hidden for Ollama ("No key needed for a local Ollama server.").
  - **Base URL**: shown for Ollama, OpenAI-compatible, and OpenRouter.
  - **Writing model** and **Structuring model**: text inputs with suggestions from the provider's model list (§10.2).
  - Help line: "Writing model drafts prose and ideas. Structuring model turns responses into card suggestions; a smaller, cheaper model is fine."
  - **Advanced** (collapsed): **Context budget** (the form pre-fills 32,000 tokens and saves it; the server falls back to 60,000 when unset, §7.5), **Style allocation** (soft limit, default 2,000, range 100–20,000, §15.3), **Writing temperature** (default 0.9), **Structuring temperature** (default 0).
  - **Test connection** ("Connected. Both models respond." or the provider's error), **Cancel**, **Save settings**.
- **AI prompts**: a selector over every prompt (shared writing instructions, conversation without card context, card structuring, continuity summaries, JSON instructions, connection test, and one per writing action), marked "· Modified" when changed. **View default instructions** shows the built-in text. **Save prompt**, **Reset this prompt**, **Reset all prompts**. Saved prompts persist in `settings` and apply to future requests.
- **Style library** (§15.4).
- **LLM request log**: the latest 200 provider calls (writing, structuring, summaries, tests) with time, provider, model, input and output tokens, latency, and status. **Refresh log**.

### 5.9 Mobile

At 960px and below: bottom tabs **Story / Write / Details**. Selecting a section or card switches to Write. Opening a Details tool switches to Details.

---

## 6. HTTP API

JSON over REST under `/api`. Streaming via Server-Sent Events. Ids are ULIDs (rows created by SQL triggers use random hex ids). All mutating endpoints return the updated entity plus any side-effects (e.g. `{card, version}`).

Every request goes through one catch-all route, `src/routes/api/[...path]/+server.ts`, which tries the subplot handler, then the style handler, then core novel/card/link/version routes, then the AI handler, and returns 404 otherwise. Core errors return `{error, ...details}` with their status; validation errors return 400 with zod `issues`. When a password is set, unauthenticated `/api` calls get 401, and any non-GET request with a foreign `Origin` gets 403.

### Novels
```
GET    /api/novels                         → [{id,title,tagline,updated_at,last_opened_at}]
POST   /api/novels {title, premise?}       → {novel, premiseCard?}
GET    /api/novels/:id
PATCH  /api/novels/:id {title?, tagline?}
DELETE /api/novels/:id
POST   /api/novels/:id/open                → sets last_opened_at
GET    /api/novels/:id/overview            → {sections:[{key,count,sceneCount?,pending}], flagsPending}
GET    /api/novels/:id/search?q=…          → matching cards with snippet (titles, aliases, notes, fields, prose)
GET    /api/novels/:id/export?format=md|epub|pdf&pageSize=… → file download (§18)
```

### Cards
```
GET    /api/novels/:id/cards?section=characters        → top-level cards (no prose), with childCount, linkCount, pendingCount
GET    /api/cards/:cardId                               → card + children (no prose) + ancestors
GET    /api/cards/:cardId/prose?offset&limit            → paged prose (chars) for very long scenes
PUT    /api/cards/:cardId/prose {text, baseRev}         → full replace (small/medium scenes)
PATCH  /api/cards/:cardId/prose {ops, baseRev}          → range edits [{from,to,insert}] for long scenes (§9.3)
POST   /api/novels/:id/cards {type,subtype,title,body?,fields?,parentId?,afterId?}
PATCH  /api/cards/:cardId {title?,subtype?,body?,fields?,aliases?, baseRev}   → 409 on rev mismatch
POST   /api/cards/:cardId/move {direction: -1|1} | {parentId, afterId}
POST   /api/cards/:cardId/split {cursor, baseRev, title?} → moves prose after `cursor` into a new scene (atomic, §9.3)
DELETE /api/cards/:cardId                               → 400 for the Book voice card
GET    /api/cards/:cardId/read?cursor=…                 → stitched chapter for reader: [{sceneId,title,prose}] + next cursor
```

### Links
```
GET    /api/cards/:cardId/links                → [{id, other:{id,title,type}, label, direction}]
POST   /api/links {fromId,toId,label}
DELETE /api/links/:linkId
```

### Versions
```
GET    /api/cards/:cardId/versions             → [{id,note,source,created_at}]
POST   /api/versions/:versionId/restore        → snapshots current, then restores
```

### Conversation and AI
```
GET    /api/novels/:id/messages?scope=…        → messages of the scope's active chat
POST   /api/novels/:id/turns {scope, flow, text?, conversationScope?, includeCardContext?=true,
                              onlyCurrentCard?=false, styleExclusions?:[]}   → {turnId}
GET    /api/turns/:turnId                      → turn with context_manifest, style_context, style_exclusions
GET    /api/turns/:turnId/stream               → SSE events: text (delta) | phase (writing|structuring) | context (manifest)
                                                  | style (layers) | progress ({completed,total,message}) | suggestions (array) | done | error
POST   /api/turns/:turnId/retry-structure      → reruns pass 2 only → {suggestions}
```

`conversationScope` lets a scene or beat turn post into its own or its chapter's chat. A turn whose stream is closed by every client before it finishes is aborted ("Stopped.").

### Chats and pins (§17)
```
GET    /api/novels/:id/chats                   → all chats, newest first (active and archived)
GET    /api/novels/:id/chats/:chatId           → {chat, messages}
POST   /api/novels/:id/chats {scope}           → starts a new active chat, archiving the old one (409 while a turn runs)
GET    /api/novels/:id/pins                    → pinned assistant messages, newest pin first
PUT    /api/novels/:id/pins/:messageId         → pin
DELETE /api/novels/:id/pins/:messageId         → unpin
```

### Suggestions
```
GET    /api/novels/:id/suggestions?scope=…&cardId=…&status=pending
POST   /api/novels/:id/suggestions/generate {scope, instruction?}  → "Suggest cards" from the whole active chat → {suggestions}
POST   /api/suggestions/:id/accept {edits?, force?, previewRev?, replaceEdited?}  → applies (§8.6)
POST   /api/suggestions/:id/reject             → marks rejected, records rejection fingerprint
POST   /api/suggestions/accept-batch {ids:[]}  → {results:[{id, …changed} | {id, error, status}]}
```

### Checks and settings
```
POST   /api/novels/:id/checks/run              → runs deterministic checks (§11), returns new flags
GET    /api/settings                           → provider, models, baseUrl, budgets, temps, hasKey (never returns the key)
PUT    /api/settings {provider, apiKey?, baseUrl?, modelWrite, modelStruct, budget?, styleBudget?, contextWindow?, temps?}
POST   /api/settings/test {…unsaved settings?} → {ok, write:{ok,msg}, struct:{ok,msg}}
GET    /api/settings/models?provider&baseUrl   → model list from provider
GET    /api/settings/prompts                   → [{id, defaultValue, value, modified}]
PUT    /api/settings/prompts {id, value|null}  → save one prompt, or reset it with null
DELETE /api/settings/prompts                   → reset all prompts
GET    /api/settings/requests                  → last 200 llm_requests rows
```

### Voice & Style (§15)
```
GET    /api/novels/:id/style/resolve?scope=…|chapterId=…&sceneId=…&onlyCurrentCard=1 → prepared style layers
PUT    /api/cards/:cardId/style {mode: inherit|preset|none, presetId?, baseRev}  → sets the chapter/scene preset link
POST   /api/cards/:cardId/apply-style {category, slug, mode: replace|append, baseRev, asPreset?, traits?}
                                                → copies a library entry's text into the card
PUT    /api/scenes/:sceneId/pov {characterId|null, baseRev}
GET    /api/style/:styleCardId/usage           → chapters and scenes that use a preset
GET    /api/style-library?all=1                → entries (built-in, overridden, custom; all=1 includes hidden)
GET    /api/style-library/:category/:slug
PUT    /api/style-library/:category/:slug      → save a custom entry or a built-in override
DELETE /api/style-library/:category/:slug
POST   /api/style-library/:category/:slug/reset | hide | show
POST   /api/style-library/:category/:slug/assist {action: improve|sample, body?}  → {body, why} proposal
GET    /api/style-library/export               → reefnote-style-library.zip
POST   /api/style-library/import?name=…&category=…&overwrite=1  (raw .md or .zip body, ≤5 MB)
```

### Subplot mode (§16)
```
GET    /api/novels/:id/subplots                → subplots (migrates legacy plot cards first; hides aliases)
POST   /api/novels/:id/subplots {title, premise?, …}
GET    /api/subplots/:id                       → outline: subplot, turning points, elements
PATCH  /api/subplots/:id {…, baseRev}
POST   /api/subplots/:id/approve {baseRev}
POST   /api/subplots/:id/turning-points {…}
POST   /api/subplots/:id/elements {…}          → adds a new or existing scene as an element
POST   /api/subplots/:id/reorder {kind: turning_points|elements, ids, baseRev}
POST   /api/subplots/:id/generate {kind: premise|turning_points|specs, …}  → proposal
PATCH  /api/turning-points/:id {…}   DELETE /api/turning-points/:id {baseRev}   POST /api/turning-points/:id/approve {baseRev}
GET    /api/elements/:id
PUT    /api/elements/:id/spec {…, baseVersion}
POST   /api/elements/:id/approve {baseVersion}
POST   /api/elements/:id/generate {…}          → AI prose draft as a proposal
POST   /api/elements/:id/approve-prose {baseVersion}  → rolling summary + card extraction
PUT    /api/elements/:id/summary {summary, baseVersion}
POST   /api/elements/:id/extract
GET|POST|DELETE /api/elements/:id/links {linked_element_id, type: depends_on|shares_scene_with}
GET    /api/elements/:id/mentions              → {mentions, missing}
GET    /api/cards/:cardId/impact               → elements where the card appears
POST   /api/cards/:cardId/merge {target_id}
GET    /api/novels/:id/subplot-work?subplot_id=…&card_id=…  → {change_sets, proposals, extractions, requests}
POST   /api/novels/:id/change-sets {…}         → starts an impact rewrite run
GET    /api/change-sets/:id
POST   /api/change-sets/:id/resolve {action: accept|reject, …hunk or element selection}
POST   /api/change-sets/:id/retry | cancel | rollback
POST   /api/extractions/:id/resolve {…}
POST   /api/subplot-proposals/:id/accept {…}   POST /api/subplot-proposals/:id/reject
GET    /api/subplot-requests/:id               → exact context, result, status
```

---

## 7. Context assembly

Every AI flow builds its prompt from a **context recipe**: an ordered list of context items, each with a priority. The assembler fills a token budget from highest priority down, degrading items to cheaper **forms** when space runs out.

### 7.1 Context item forms

Each card can be rendered in three forms:

| Form | Content | Typical size |
|---|---|---|
| `full` | type, subtype, title, aliases, body, fields, links (titles + labels) | as large as the card |
| `digest` | type, subtype, title, `digest` (≤120 words) | ~150 tokens |
| `ref` | type, subtype, title | ~10 tokens |

Prose has its own forms: `prose_full`, `prose_tail(n_tokens)`, `prose_head(n_tokens)`, `prose_window(around, n_tokens)`, `prose_digest` (the scene's digest).

Rendering format (consistent across all prompts, plain text, no JSON):

```
=== CHARACTER: Stephen Blacksmith (protagonist) [id:01J…] ===
Also called: Steve
Ex-navy pilot, 41. Lost his brother Daniel in the Titan riots (2187)…
Links: brother of → Daniel Blacksmith; drives → The smuggler's debt
```

Card ids are included so pass 2 can reference existing cards precisely.

### 7.2 Standard items

| Item | Definition |
|---|---|
| `self` | The scoped card, `full` |
| `ancestors` | Parent chain (beat → scene → chapter), `full` for parent, `digest` above |
| `children` | Direct children, `digest` (or `full` for beats under a scene) |
| `linked` | Cards linked to self in either direction, `full` |
| `linked2` | Cards linked to `linked` (second hop), `ref` |
| `section_cards` | All top-level cards in the scope's section, `digest` |
| `cast_of_scene` | CAST_LABELS links of the scene, `full` |
| `threads_of` | THREAD_LABELS links of self/descendants, `full` for the thread card |
| `rules` | All `rule` cards, `digest` (rules matter everywhere in genre fiction) |
| `premise` | Premise card, `full` |
| `outline` | Outline cards, `digest` |
| `prev_scene_tail` | Last ~1,500 tokens of the previous scene's prose (by reading order, crossing chapter boundaries) |
| `next_scene_plan` | Next scene's plan `full` (so drafting doesn't contradict what comes next) |
| `chapter_so_far` | Digests of earlier scenes in the same chapter |
| `story_so_far` | Digests of all earlier chapters (chapter digest = digest of its scenes) |
| `thread` | Last N messages in this scope (default 10), oldest dropped first |
| `rejections` | Rejected suggestions in this scope (what lines), max 20 |
| `user_message` | The user's text for this turn |

### 7.3 Recipes per flow

Priorities: P0 = always included (truncate only as last resort), P1 = high, P2 = medium, P3 = nice to have. Within a priority, items are degraded `full → digest → ref` before anything at the same priority is dropped.

| Flow | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| `capture` (section chat, free text) | user_message, premise | section_cards, thread | rules, outline | rejections |
| `brainstorm` (section or card chat) | user_message, self or section_cards, premise | linked, thread | rules, outline, threads_of | rejections |
| `flesh` / `expand` / `wantneed` / `hooks` | self | linked, ancestors, premise | rules, outline, thread | linked2, rejections |
| `links` (suggest links) | self, **candidate list** (§8.3) | — | — | rejections |
| `who` (scene cast) | self (plan + prose_head 2k), candidate cast list (characters/groups/settings/objects as `ref` + aliases) | ancestors | — | rejections |
| `threads` | self (+children digests), all thread cards `digest` | ancestors | — | rejections |
| `scenes` (brainstorm scenes for a chapter) | self (chapter full), children | threads_of, premise, outline | story_so_far, rules | rejections |
| `beats` | self (scene full), children, cast_of_scene | ancestors, threads_of | rules | rejections |
| `payoff` | self (setup beat), ancestors | story_so_far, list of later chapters/scenes `digest` | threads_of | rejections |
| `escapes` / `earned` | self (trap fields), ancestors | cast_of_scene, linked (objects/rules), story_so_far (to find earlier setups) | rules | — |
| `draft` | self (plan), children (beats full), cast_of_scene, prev_scene_tail | ancestors, threads_of, next_scene_plan, rules | chapter_so_far, story_so_far | thread |
| `dialogue` | self (plan), cast_of_scene **full incl. voice notes**, prose_window around cursor/selection (or prose_tail) | children, prev_scene_tail | rules | thread |
| `check` (scene) | self prose (chunked, §9.4), cast_of_scene, linked, rules | ancestors, story_so_far | — | — |
| `check` (chapter) | each scene in turn as above (map), then reduce | — | — | — |
| `ask` (read-only) | user_message, retrieval results (§7.7) | section/overview digests | — | — |

### 7.4 Digests

- Every card and every scene's prose has a `digest`: a ≤120-word factual summary written by the **structuring model**.
- Recompute lazily: when a card's `rev` > `digest_rev` and the digest is needed for context, or in a background queue 30s after the last edit (debounced). Never block a user action on digest generation; if a digest is stale and a fresh one isn't ready, use `full` truncated to the same budget.
- Chapter digest = digest of its scene digests (recomputed when any scene digest changes).
- Prompt: "Summarise this for a co-writer who needs the facts: who, what, where, when, what changed. No interpretation. ≤120 words."

### 7.5 Budgeting

- Token estimation: use the provider's tokenizer when cheaply available; otherwise `ceil(chars / 3.6)`.
- Budget = `min(model_context_window * 0.6, settings.budget || 60_000)` tokens for context, leaving room for instructions and output. Output reserve: 4k tokens default; 8k for `draft`.
- Assembly algorithm:
  1. Add all P0 items at their default form. If over budget, degrade P0 non-`self` items, then truncate `self` prose to the most relevant window.
  2. For P1…P3: add each item at default form; if it doesn't fit, try `digest`, then `ref`; if still no fit, skip.
  3. Deduplicate: a card appears once, at its richest form.
- Model context windows come from a table in `providers/models.ts` (editable; unknown models default to 32k).

### 7.6 Context manifest

Store what was sent in `turns.context_manifest` (`[{card_id, form, tokens}]`). The UI shows it as the small "Context used: …" line under draft/dialogue responses, and it's invaluable for debugging.

### 7.7 Retrieval (Ask flow and mention candidates)

Use SQLite FTS5 over cards and per-scene prose. For Ask: extract key terms (structuring model, or simple noun-phrase heuristics), run FTS with `bm25`, take top 20 hits, render each as card `digest` + a 400-token prose window around the hit.

---

## 8. AI pipeline

### 8.1 Turn lifecycle

```
POST /turns → create turn(status=writing) → assemble context → PASS 1 (writing model, streamed)
            → save assistant message → status=structuring → PASS 2 (structuring model, JSON)
            → validate → filter (rejections, duplicates, invalid refs) → insert suggestions
            → status=done → SSE 'suggestions' + 'done'
```

- Pass 1 streams to the client as `text` events.
- If pass 2 fails validation, retry once with the validation error appended. If it fails again, finish the turn with zero suggestions and set `error` (the pass-1 text still stands; the UI shows "Couldn't turn this into cards. Try again." with a retry button that reruns pass 2 only).
- These flows skip pass 2: the read-only flows (`ask`, `earned`, `recommend_style`) and the conversational flows (`capture`, `brainstorm`, `card_chat`). Conversational chats become cards only when the writer asks with **Suggest cards** (`POST /suggestions/generate`, §17), which reads the whole chat and keeps the latest decisions.
- With **Send card context** off, the turn uses the `conversation` prompt with no cards, style, or pass 2.
- Cancellation: when every client closes the SSE stream, the server aborts the provider request; turn status `error`, message "Stopped."
- Every provider call is logged in `llm_requests`.

### 8.2 Flow catalogue

| Flow | Trigger in UI | Scope | Pass 2 may emit |
|---|---|---|---|
| `capture` | Free text in a section composer | section | create_card, add_link, update_card |
| `brainstorm` | Free text asking for options; quick-prompt chips | section or card | create_card, add_link |
| `expand` | *Expand to a paragraph*, *Expand this* | premise/outline card | update_card (append), create_card (next outline level) |
| `flesh` | *Flesh out…*, *Strengthen the plan*, *Sharpen this beat*, *Map the turning points*, *Add complications* | card | update_card (append) |
| `wantneed` | *Want vs. need* | character | update_card |
| `hooks` | *Sharpen the hooks* | chapter | update_card (replace fields.opens / fields.closes) |
| `links` | *Suggest links* | card | add_link |
| `who` | *Suggest who and where* | scene | add_link (CAST_LABELS) |
| `threads` | *Suggest threads* | chapter or scene | add_link (THREAD_LABELS) |
| `scenes` | *Brainstorm scenes* | chapter | create_card (scene, parent=chapter) |
| `beats` | *Suggest beats* | scene | create_card (beat, parent=scene) |
| `payoff` | *Find a payoff* | setup beat | create_card (payoff beat) + add_link (pays off) |
| `escapes` | *Brainstorm other escapes* | trap beat | update_card (fields) optional; usually none |
| `earned` | *Is the escape earned?* | trap beat | none (read-only) |
| `draft` | *Draft this scene* | scene | update_card (prose, append) |
| `dialogue` | *Write the dialogue* | scene | update_card (prose, append or replace selection) |
| `check` | *Check continuity*, *Check chapter continuity* | scene or chapter | flag_issue |
| `ask` | Composer in Continuity view | flags | none |
| `card_chat` | Composer while a card is open | card | none automatically; **Suggest cards** may emit any action (§17) |
| `chapter_draft` | *Draft chapter* | chapter with scenes | update_card (prose) per scene |
| `style_draft` | Draft this style card from the story context | style card | update_card |
| `style_presets` | *Suggest presets* | Voice & Style section | create_card (preset) + add_link / set_link (assignments) |
| `sample_rules` | Turn sample passages into observable rules (samples kept) | style card | update_card |
| `voice_draft` | Draft a character's `## Voice` section, keeping other text | character | update_card |
| `style_merge` | Merge a library style into this card, keeping unrelated content | style card | update_card |
| `recommend_style` | *Recommend a style* | Voice & Style section | none (read-only) |

Free-text messages in a scope: in a section → `capture`/`brainstorm`; on a card → `card_chat` using the `flesh` recipe plus `thread`.

**`chapter_draft`** requires a chapter with at least one scene, **Send card context** on, and **Send only current card** off. It drafts every scene in order, following each scene's plan, beats, and linked characters, and produces one prose suggestion per scene. Each is reviewed and accepted in Details; accepting replaces that scene's prose (the previous text stays in History). Pass 2 is not rerun for this flow.

**`set_link`** suggestions (from `who`, `capture`, `card_chat`, and `style_presets`) replace a scene's single `POV` link or a chapter/scene's `uses_style` link. They go stale if the target card changed, like `replace` updates. A preset plus its assignments is one atomic suggestion; if an assignment target changed, the writer must review it again.

### 8.3 Link candidates (no blind text matching)

For `links` and `who`, the server prepares a **candidate list** before calling the model:

1. Gather the card's text (body, fields, and for scenes, prose head 2k + any FTS hits).
2. Find mentions of every other card's title and aliases using case-insensitive whole-word matching, plus first-name-only matches for characters.
3. Exclude pairs already linked and pairs in `rejections`.
4. Send the candidates (with the matching sentence) to the model and ask it to confirm or reject each and pick a label, and to add any **implied** links it sees (e.g. "the Admiral" → Admiral Haas via alias or context).
5. Every result becomes an `add_link` suggestion. Nothing is linked until the writer accepts.

### 8.4 Prompts

Default prompts live in `src/lib/server/ai/prompt-defaults.ts` and per-flow instructions in `ai/flows/`. `prompts.ts` lets the writer override any of them from Settings (§5.8); overrides are stored in `settings` and reset per prompt or all at once. The system prompt for a turn is `preamble` + the resolved style guide (§15) + `flow.<name>`. All pass-1 prompts share a system preamble along these lines:

```
You are a co-writer on a novel. You write vividly and specifically, in the novel's voice.
You never contradict established facts in the context unless asked to.
Write in markdown. Use "## " headings to separate distinct ideas, options, or cards
you are proposing, one heading per idea. Under each heading, write the full text
that should go on the card — complete, rich, and ready to use. Do not summarise.
After the ideas, you may add a short note to the writer.
Never output JSON.
```

Per-flow instructions (append to preamble; examples):

- **capture/brainstorm**: "The writer said: {{user_message}}. If they described something specific, write it up fully as one idea per heading (one heading per new character/place/rule/etc., titled with its name). If they asked for options, give 3–6 distinct, surprising options, each under its own heading. Note any obvious connections to existing cards by name."
- **flesh** (character): "Expand {{title}}'s backstory. Cover what's missing among: childhood, defining wound, what they want, what they need, how they talk, what they fear, a contradiction. Write 150–300 words as continuous notes to add to the card, under one heading."
- **wantneed**: "State what {{title}} wants (conscious goal) and needs (what would actually make them whole), and the gap between them. Under one heading, write two lines starting 'Wants:' and 'Needs:', then explain in a short note."
- **hooks**: "Rewrite the chapter's opening and closing hooks. Opening: start in motion and raise a question. Closing: end on a turn that forces the reader to continue. Use headings '## Opens on' and '## Closes on'."
- **scenes**: "Propose 3–6 scenes that get this chapter from its opening to its closing hook. For each: heading = scene title; first line 'Type: <scene type>'; then a plan with Goal / Conflict / Outcome. Respect existing scenes; propose additions, not replacements."
- **beats**: same pattern for beats; first line 'Type: <beat type>' from the beat type list.
- **payoff**: "This setup beat has no payoff. Propose 2–3 places later in the story where it could pay off, as beats. Heading = beat title; first line 'Place in: <scene title>'."
- **escapes**: "Given the corner and the exits that fail, propose 3 alternative ways out. Prefer ones that use something set up earlier (name it). Rank them and say which is most earned."
- **earned**: "Judge whether the way out is earned: was the tool/knowledge set up earlier, and is the use surprising but fair? Answer in a short paragraph. No headings."
- **draft**: "Draft the prose for this scene, following the plan and beats in order, in the established voice. Continue seamlessly from the previous scene's ending. Stop at the end of the scene. {{length_hint}}. Output prose only under one heading '## Draft'." (Long scenes: see §9.5.)
- **dialogue**: "Write the dialogue for this moment. Each character must sound like their card (vocabulary, rhythm, what they avoid saying). Output under '## Dialogue'."
- **check**: "Read the passage against the established facts. List contradictions (facts, timeline, who-knows-what, rules), setups that never pay off, and characters acting against their established nature. For each, heading = short issue title; then: 'Where:' quote ≤20 words, 'Conflicts with:' card title + fact, 'Fix option:' one concrete fix. If nothing is wrong, say so with no headings."
- **ask**: "Answer the writer's question from the context only. Cite card titles and scene titles. If unknown, say so."

### 8.5 Pass 2: structuring

The server splits the pass-1 markdown into **sections** at `## ` headings: `S1, S2, …` (text before the first heading is `S0`, the note). Pass 2 receives: the sectioned text, a compact index of existing cards (`id, type, subtype, title, aliases`), the flow, the scope card (if any), and the allowed actions. It returns JSON via tool calling (preferred) or JSON mode, validated with zod:

```ts
type StructOut = { suggestions: Array<
 | { action: "create_card"; type: CardType; subtype?: string; title: string;
     text_ref: string;                        // e.g. "S2" — server copies that section verbatim into body
     fields_refs?: Record<string, string>;    // e.g. {corner:"S2#corner"} — sub-anchors, see below
     parent_id?: string;                      // existing card id, or "@scope"
     links?: Array<{ to_id: string; label: string; direction?: "out"|"in" }>;
     what: string; why: string }
 | { action: "update_card"; card_id: string;  // existing id or "@scope"
     field: "body" | "prose" | `fields.${string}`;
     mode: "append" | "replace";
     text_ref: string; what: string; why: string }
 | { action: "add_link"; from_id: string; to_id: string; label: string; what: string; why: string }
 | { action: "set_link"; from_id: string; to_id: string | null;  // replaces the single POV or uses_style link
     label: "POV" | "uses_style"; mode?: "inherit" | "none"; what: string; why: string }
 | { action: "flag_issue"; card_id: string; what: string; why: string;
     text_ref?: string;                        // the issue's section (becomes preview)
     fix?: { field: string; mode: "append"|"replace"; text: string } }
>}
```

Rules enforced in code, not trusted to the model:

- **Verbatim text.** For any `text_ref`, the server copies the referenced section's text exactly (minus its heading line). Pass 2 never supplies card body text. The only free text pass 2 writes is `what`, `why`, and short `fix.text` for flags.
- **Sub-anchors.** For multi-field cards, pass 1 is instructed to use bolded lead-ins (e.g. "**The corner.** …"); the server splits a section by those lead-ins so `S2#corner` resolves to that paragraph. Chapter hooks use `## Opens on` / `## Closes on` headings and map directly.
- **Subtype from text.** If a section's first line is `Type: X`, the server strips that line and uses `X` as subtype when pass 2 omitted it.
- **Reference validation.** Every `card_id`, `to_id`, `from_id`, `parent_id` must exist in the novel (or be `@scope`). Unknown ids → drop that suggestion. Type must be valid; `scene` parents must be chapters; `beat` parents must be scenes.
- **Flow permissions.** Drop actions not allowed for the flow (§8.2).
- **Deduplication.** Drop `add_link` if the link exists or a pending identical suggestion exists. Drop `create_card` whose title exactly matches an existing card of the same type (instead, if pass 2 marked it, convert to `update_card` append on that card).
- **Rejection filter.** Compute fingerprints (§8.7); drop anything previously rejected.
- **Preview.** `preview` = first 600 chars of the referenced text (UI shows a scrollable box; full text applies on accept).
- **base_rev.** For update/flag on existing cards, store the target's current `rev`.

### 8.6 Applying suggestions

`POST /suggestions/:id/accept` runs in a single SQLite transaction:

1. Load suggestion; if `status != pending`, 409.
2. **Staleness**: if `target.rev != base_rev`:
   - `add_link`, `create_card`: apply anyway (they don't overwrite).
   - `update_card` with `append`: apply anyway (appending is safe).
   - `update_card` with `replace`, `flag_issue` with a `replace` fix, or a `set_link`/`add_link` for `POV` or `uses_style`: mark `stale`, return 409 with `{reason:"changed"}`; the UI shows "This card changed since the suggestion was made" with **Apply anyway** (re-POST with `force:true`) or **Dismiss**.
   - Prose suggestions reviewed in the editor send `previewRev`; if the scene's prose changed since the review opened, accept fails with 409 ("Scene prose changed. Reopen the review before applying.").
3. Snapshot the target into `versions` (`source='suggestion'`, `suggestion_id`).
4. Apply:
   - `create_card`: insert card at end of siblings (or at `parent_id`), insert any `links`, create an initial version "Created from co-writer".
   - `update_card`: `append` → `existing + "\n\n" + text`; `replace` → `text`. For `prose` use the prose table.
   - `add_link`: insert link.
   - `flag_issue`: if `fix` present, apply it like `update_card`; otherwise just resolve.
   - If the user passed `edits` (edited preview text), use the edited text.
5. Bump `rev`, update `fts`, mark suggestion `accepted`, schedule digest refresh.
6. Return the changed entities so the client updates in place.

**Reject** (`It's intentional` / `Dismiss`): mark `rejected`, insert fingerprint into `rejections`.

**Undo**: there is no special undo; History → Restore on the affected card snapshots the current state and restores the prior snapshot. For `create_card`, the user deletes the card. (Optional nicety: a toast "Added Oduya · Undo" that deletes the created card within 8s.)

### 8.7 Rejection fingerprints

Deterministic, so dismissed ideas don't return:

- `add_link`: `link:{from_id}:{to_id}:{normalize(label)}`
- `create_card`: `create:{type}:{normalize(title)}`
- `update_card`: `update:{card_id}:{field}:{simhash(text)}` (near-duplicate text counts as the same)
- `flag_issue`: `flag:{card_id}:{normalize(what)}`

Also pass the last 20 rejected `what` lines for the scope into prompts as "The writer already rejected these; don't suggest them again."

### 8.8 Versions

Create a version before every change, from any source. To avoid thousands of versions while typing:

- Card fields: version on blur if text changed.
- Prose: version on blur, on every accepted suggestion, and otherwise at most once every 5 minutes of active editing.
- Store snapshots gzip-compressed. For scenes over 200k chars, store prose snapshots as a diff against the previous version (use `diff-match-patch`), with a full snapshot every 20 versions.

---

## 9. Scale: very long chapters (300 pages and beyond)

Target: a single chapter of 300 pages (~90k words, ~120k tokens) must work end to end. The design guarantees this by making the **scene** the unit of storage, editing, drafting, and checking, and by never sending whole chapters to a model.

### 9.1 SQLite limits

SQLite's default max string/BLOB is 1 GB (`SQLITE_MAX_LENGTH`), far above any novel (a 1,000-page novel is ~2–3 MB of text). Row count and database size limits (terabytes) are irrelevant. WAL mode keeps reads fast during writes. No feature is limited by SQLite.

### 9.2 Reading a long chapter

`GET /cards/:id/read` returns scenes in order. If total prose exceeds 500k chars, it returns the first ~200k chars plus `next` cursors; the reader lazy-loads as the user scrolls (IntersectionObserver). Each scene renders as its own block so the DOM stays manageable; use `content-visibility: auto` on scene blocks.

### 9.3 Editing long prose

- Use CodeMirror 6 for prose (virtualised; handles multi-MB documents smoothly).
- Scenes under 200k chars: `PUT` full text on blur/debounce.
- Larger: send `PATCH` with range ops `[{from,to,insert}]` and `baseRev`; server applies ops to stored text. On `baseRev` mismatch (another tab), return 409 with latest text; client merges or prompts.
- A single scene that grows past ~30k words should prompt a gentle, dismissible hint: "This scene is very long. Splitting it makes drafting and checks sharper." with a *Split at cursor* action (creates a new scene with the text after the cursor).

### 9.4 Continuity checks on long text (map-reduce)

- **Chunking**: split prose into ~6k-token chunks at paragraph boundaries with ~500-token overlap.
- **Map**: for each chunk, run `check` with the scene's context recipe (cast, rules, linked, story_so_far digests). Run up to 3 chunks in parallel (configurable). Each returns issues.
- **Reduce**: deduplicate issues across chunks (same `what` + same conflicting card); pass 2 structures the merged list into `flag_issue` suggestions with the chunk location as `preview` quote.
- **Chapter check**: map over scenes (each scene itself chunked as above), then reduce across the chapter.
- Progress is streamed to the UI ("Checking 4 of 23 passages…").

### 9.5 Drafting long scenes

- `draft` writes up to the output limit (e.g. ~3–6k words). If the scene plan or beats call for more, the server continues automatically in segments: segment N+1 receives the plan, beats, cast, and the last ~1,500 tokens of the text so far, plus "Continue from here. Beats already covered: … Remaining: …". The result is still one suggestion (an `update_card` append to prose) assembled from all segments, previewed as it streams.
- Beats provide the natural segmentation: when a scene has beats, draft beat by beat.

### 9.6 Long-context everywhere else

- Context never includes full chapters; it includes the scoped scene and **digests** for everything else (§7.3–7.5).
- `prev_scene_tail` keeps voice continuity across scene and chapter boundaries without loading full text.
- Digests keep "story so far" at ~150 tokens per scene: even 300 scenes ≈ 45k tokens; if that exceeds budget, use chapter digests instead (~150 tokens per chapter).

---

## 10. Providers, BYOK, and models

### 10.1 Adapter interface

```ts
interface Provider {
  id: "anthropic" | "openai" | "google" | "openrouter" | "ollama" | "openai_compatible";
  listModels(): Promise<{ id: string; contextWindow?: number }[]>;
  stream(opts: { model: string; system: string; messages: Msg[]; maxTokens: number;
                 temperature: number; signal: AbortSignal }): AsyncIterable<string>;
  structured<T>(opts: { model: string; system: string; prompt: string;
                        schema: ZodSchema<T>; maxTokens: number; signal: AbortSignal }): Promise<T>;
  test(model: string): Promise<{ ok: boolean; msg: string }>;
}
```

- `structured` uses native tool calling / JSON schema where the provider supports it; otherwise "respond with JSON only" plus fence-stripping and zod validation.
- OpenRouter and OpenAI-compatible (LM Studio, vLLM, Together, etc.) share the OpenAI adapter with a custom base URL.
- Ollama uses its OpenAI-compatible endpoint at `{baseUrl}/v1`.

### 10.2 Model selection

- Settings stores `modelWrite` and `modelStruct` (may be the same model).
- Model fields are free-text inputs with suggestions from `listModels()` (providers add models faster than lists update).
- A small built-in table in `providers/models.ts` provides context windows for well-known models; unknown → 32k (user can override in Advanced).

### 10.3 Key storage

- On first run, generate a 32-byte random `./data/secret.key` (file mode 600).
- Store API keys in `settings` encrypted with AES-256-GCM using that key. `GET /api/settings` returns `hasKey: true`, never the key.
- Keys are only ever sent to the selected provider's endpoint.
- Server binds to `127.0.0.1` by default. If `HOST` is set to a non-loopback interface, require `NOVEL_STUDIO_PASSWORD`; `scripts/start.mjs` refuses to start without it, and `hooks.server.ts` answers 503 as a second guard.
- Password auth: a sign-in page at `/login`; passwords are compared with constant-time HMAC; sessions are `novel_session` cookies holding an expiry and an HMAC signature keyed by the password (7-day lifetime, `HttpOnly`, `SameSite=Strict`, `Secure` over HTTPS); 10 failed attempts per IP lock sign-in for a minute. Changing the password invalidates all sessions.
- Non-GET requests with an `Origin` header that differs from the app's origin are rejected (403), with or without a password.
- Private remote access is documented in the README (`npm run remote`: Tailscale Serve, app still bound to localhost).

### 10.4 Errors

Map provider errors to plain messages: invalid key → "The provider rejected the API key. Check it in Settings."; rate limit → "The provider is rate-limiting requests. Try again in a minute."; context too long → automatically retry with budget × 0.7, then report; network → "Couldn't reach the provider."

---

## 11. Deterministic checks (no AI)

Run after every accepted change (debounced 2s) and on `POST /checks/run`. They create `flag_issue` suggestions with `origin='rule'` (same UI, same rejection memory). Fingerprints prevent re-raising dismissed flags.

| Check | Rule | Flag text |
|---|---|---|
| Setup without payoff | beat subtype `setup` with no outgoing or incoming `pays off` link | "Setup has no payoff" |
| Payoff without setup | beat subtype `payoff` with no `pays off` link | "Payoff has no setup" |
| Subplot goes quiet | a plot with thread links whose chapter indices have a gap ≥ 2 chapters, or opened but never `resolves` once the last chapter exists | "Subplot goes quiet" / "Subplot never resolves" |
| Open question never answered | question with `opens` but no `resolves` | "Question never answered" |
| Character disappears | a character with `POV`/`present` links whose last appearance is ≥ 6 chapters before the latest chapter with scenes | "<name> hasn't appeared in N chapters" |
| Chapter missing hooks | chapter with empty `opens` or `closes` and at least one scene | "Chapter has no opening/closing hook" |
| Thin outline | `one page` outline under 150 words while ≥ 3 chapters exist | "Outline is still a sketch" |
| Scene with no POV | scene with prose but no `POV` link | "Scene has no point-of-view character" |

Logging every check result in a `check_runs` table (as a data source for the future game layer) is **not implemented**.

A style migration also raises a one-time rule flag, "Review point-of-view character", for scenes that had several legacy `POV` links (the earliest valid one is kept).

---

## 12. Client architecture notes

- **API style.** Use `+server.ts` JSON endpoints for everything in §6, not form actions. Streaming turns and accept/reject need endpoints anyway, and a stable JSON API keeps the door open for other clients later. Page `load` functions call the same repository functions directly on the server for the initial render.
- **State.** There is no `stores/` directory. `Studio.svelte` owns workspace state (novel, section, card, Details tab, reading mode, mobile tab, collapsed panes, chat width, chats, pins, suggestions) and reloads from the API after mutations. `SubplotEditor.svelte` owns subplot mode state and reports its selection back to the workspace. Per-viewer preferences such as the theme are kept in `localStorage`.
- **Streaming.** One `EventSource` per active turn (`/api/turns/:id/stream`). Append `text` deltas to the in-progress message; on `context`/`style`, update the context and style lines; on `suggestions`, refresh suggestions and affected card data.
- **Prose editor.** Wrap CodeMirror 6 in a `ProseEditor.svelte` component. Mount on the client only (`onMount`). Debounced saves per §9.3.
- **Keyboard.** Enter send, Shift+Enter newline, Esc closes menus/dialogs and clears search. A `⌘K`/`Ctrl+K` shortcut for card search is not implemented (search is in the toolbar, §5.2).
- **Accessibility.** Visible focus rings (accent), all icon-only buttons have `aria-label`, dialogs use `<dialog>` with focus trapping, `prefers-reduced-motion` respected.

---

## 13. Build order and acceptance criteria

**Milestone 1 — Core writing (no AI)**
Novels CRUD + switcher; sections, cards, nesting, ordering; card detail for every type incl. chapter fields and trap-and-escape fields; links (manual add via a simple picker); versions + restore; reader view; settings page (stored, not used yet). *Accept:* create a novel, add 3 chapters × 3 scenes × 3 beats, reorder, edit, restore a version, read a chapter.

**Milestone 2 — AI plumbing**
Provider adapters, settings test, SSE turns, context assembler with manifest, pass 1 + pass 2, suggestion tray, accept/reject/stale, rejection memory. *Accept:* "Add a smuggler called Oduya…" in Characters produces a character suggestion whose body is pass-1 text verbatim; accept creates the card with links; dismissed link never reappears.

**Milestone 3 — All flows**
Every flow in §8.2 wired to its chip; digests; `who`/`links` candidate pipeline; draft with segmentation; dialogue; Ask. *Accept:* every chip in the prototype works against a real model.

**Milestone 4 — Scale and checks**
Map-reduce continuity; long-prose PATCH editing and lazy reader; deterministic checks. *Accept:* import a 300-page chapter (paste into one scene, or split into 60 scenes), read it, edit it, run a chapter continuity check, draft a new scene after it — all without errors or UI stalls over 200ms.

**Milestone 5 — Polish**
Mobile layout, dark mode, empty states, error copy, manuscript export, README with screenshots.

**Status (v1.1).** Milestones 1–5 are built, plus the post-v1 work in §15–§18. Remaining gaps: the strict 200ms UI-stall target is not instrumented; live model quality is not covered by automated tests (providers are mocked); `check_runs` logging (§11) is not implemented; DOCX export was dropped in favour of EPUB and PDF (§18).

Verification: `npm run check` (svelte-check + TypeScript), `npm test` (Vitest; AI providers are mocked), `npm run build`, and the Playwright smoke scripts in `scripts/smoke-*.mjs`, which run against a disposable server.

---

## 14. Out of scope (parked by decision)

- The game layer (board view, alert feed, quests).
- Optional method overlays (Snowflake, Save the Cat, Hero's Journey).
- Merging two pending `create_card` suggestions into one card. (Merging two existing cards is available in subplot mode, §16.)
- Collaboration, multi-user, cloud sync.
- Maps and relationship graph visualisations.
- DOCX export.
- Soft delete / recovering deleted cards.

---

## 15. Voice & Style

Style guidance is stored as cards, so it is versioned, linkable, and editable like everything else, and is layered into prompts by a deterministic resolver.

### 15.1 Cards and fields

- **Book voice** (`style`/`book`): exactly one per novel, created by trigger with the headings `## POV & tense`, `## Prose texture`, `## Tone & comps`, `## Do`, `## Don't`, `## Sample passages`. It can be emptied but not deleted.
- **Presets** (`style`/`preset`): reusable named styles (for example "Action sequence" or "Flashback"), created in the Voice & Style section or from the library.
- **Assignments:** a chapter or scene links to at most one preset with `uses_style`. A scene's `fields.stylePresetMode` is `inherit` (use the chapter's preset), `preset` (its own), or `none`. Set with `PUT /cards/:id/style`.
- **Notes:** `fields.styleNotes` on chapters and scenes. Chapter notes and scene notes always add together.
- **Character voices:** a character's `## Voice` section with `### Dialogue` and `### Interior` subsections.
- **POV:** a scene's single `POV` link to a character (`PUT /scenes/:id/pov`).

The **Style** tab in Details edits these for the open card, shows which chapters and scenes use a preset, and shows the **effective style** that will be sent.

### 15.2 Resolution order

For a scene in a chapter (`resolveStyle` in `style/resolve.ts`), layers are collected in this order; later layers override earlier ones only where they conflict:

1. `book`: the Book voice body.
2. `preset`: the scene's own preset, else the chapter's (none when the scene's mode is `none`).
3. `chapter_notes`: the chapter's style notes.
4. `scene_notes`: the scene's style notes.
5. `pov_interior`: the POV character's `### Interior` voice. It colours diction, perception, and emotion but never changes narrative person or tense.
6. `dialogue_voice`: the `### Dialogue` voice of every on-stage character (POV, `present`, or an `on_stage` element card in subplot mode), used only for that character's dialogue.

Beats resolve through their scene; chapters resolve without the scene layers. With **Send only current card**, only the open card's own style notes are used. Empty layers are skipped. Every layer records its source card id, title, and `rev`.

### 15.3 Budget and formatting

- Narrative layers are sent inside `<style_guide>…</style_guide>`; dialogue voices inside `<character_voices>…</character_voices>`. Sample passages are marked as examples, not events to write.
- The style allocation defaults to 2,000 estimated tokens (Settings → Advanced, 100–20,000). If the stack is over it, sample passages are removed from the Book voice first. Required rules and notes are never silently truncated: if they don't fit the total context budget, the turn fails with an error.
- **Chat context** lets the writer exclude individual layers for one send (`styleExclusions`). **Send card context** off disables style entirely.
- The style applies to scene drafting, dialogue drafting, chapter drafting, and chat scoped to a chapter, scene, or beat. Brainstorming flows don't apply it.
- Each turn stores the exact layers it received in `turns.style_context`, shown as **Style used for this response** even if the source cards change later.

### 15.4 Style library

- Four categories, each a folder of Markdown files with frontmatter: `book-voice`, `character-voices`, `scene-presets`, and `style-traits` (structured trait groups). Built-ins ship in `src/lib/style-library/`.
- Edits and custom entries live in `style-library/` beside the database (`data/style-library/` by default). Editing a built-in writes an override; **Reset** removes it. Entries can be hidden and shown.
- **Applying** an entry copies its text into a novel card (replace or append, optionally as a new preset). Later edits to the library never change existing copies.
- **Import** accepts a Markdown file with frontmatter or a ZIP of `category/slug.md` files, up to 5 MB. It rejects path traversal, oversized entries and archives, and name collisions unless overwrite is chosen. **Export** produces a ZIP whose frontmatter uses JSON-quoted values and JSON arrays for tags and trait groups.
- **AI assist** on a library entry (`improve` or `sample`) returns a proposed body and reason; the writer accepts it into the editor and saves explicitly.
- Style presets, notes, and character voices are never included in manuscript exports.

---

## 16. Plot-first subplot mode

Subplot mode develops a plot top-down: premise → turning points → elements (scenes) → prose, with the AI proposing and the writer approving at each level. It lives at `/n/:novelId/subplots` inside the same workspace (`SubplotEditor.svelte`), with the subplot navigator in the rail. Behaviour is also described for writers in `docs/subplot-mode.md`.

### 16.1 Structure

- A **subplot** has a title, premise, theme, start state, end state, and status (`draft` → `approved`). Legacy `plot` cards are migrated into subplots on first access; their history, links, chats, and suggestions move with them, and empty identical duplicates are hidden as aliases. There is one plot editor and no separate Notes field.
- **Turning points** are optional, ordered, and collapsed by default. Deleting one keeps its elements directly under the premise.
- **Elements** are scene cards with subplot data: purpose, target length (default 1,200 words), time marker, rolling summary, status, prose state, and version. Adding an existing scene keeps its chapter placement and prose. A scene can belong to a subplot and a chapter at once. Chapterless elements are excluded from manuscript exports.
- **Element cards** record which cards appear in a scene, `on_stage` or `referenced`, and for secrets whether they are `introduced`, `hinted`, or `revealed`. **Element links** record `depends_on` and `shares_scene_with`.

### 16.2 Workflow

1. Write or generate the premise, then approve it.
2. Add or generate turning points and scenes (**Add scene** beside the scene list). Each scene has **Plan** and **Prose** tabs.
3. Approve each scene's plan (spec) before generating prose. **Draft scene with AI** creates a proposal that can be edited before acceptance; writing prose directly is always allowed.
4. Approving prose writes a rolling summary and opens **card extraction** proposals. Extraction never changes cards until confirmed.

AI proposals (premise, turning points, specs) are stored in `subplot_proposals` with the base revision, and accept or reject individually. Every AI call is logged in `subplot_requests` with the exact assembled context, model, result, and status.

### 16.3 Context rules

A subplot AI call includes only the target element's full prose. Other elements contribute their summaries, specs, and the previous element's ending. Full on-stage card bodies are kept even when they exceed the nominal card budget, and the log records that overflow.

### 16.4 Impact rewrites, review, and rollback

- Cards show **Appears in**, separating on-stage and referenced mentions (from the `mentions` index, rebuilt when prose changes). Saving an entity card with appearances opens its **impact** view.
- The writer chooses elements (on-stage ones preselected) and starts a rewrite run: a `change_set` of `change_hunks` for prose, summary, or spec, each with before/after text and surrounding context.
- **Review & history** shows summary and passage diffs. Hunks are accepted or rejected individually or per element. Manual prose edits stay possible; a hunk whose base prose changed fails without overwriting text. Pending changes on the same elements must be resolved before a new set starts.
- Interrupted, failed, or cancelled runs keep completed hunks and offer an explicit **Retry** for unfinished work. Runs left running when the server stopped are marked interrupted on boot.
- **Rollback** of an applied change set checks every accepted passage first; if any changed since, nothing is restored.
- Upstream edits and reordering add **review badges** (`review_reason`) to turning points and elements; **Still fine** clears a badge without rewriting. Ripple checks only add review reasons; they never edit prose.
- Two cards can be **merged** (`POST /cards/:id/merge`).

---

## 17. Chats, archive, and pins

- **Chats.** Each scope (section, card, or subplot) has at most one active chat (`chats_active` unique index). **+ New chat** archives the current one and starts fresh; it is refused while a turn is running. A scene or beat may post into its chapter's chat (`conversationScope`).
- **Archive.** `/n/:novelId/archive` lists every chat in the novel, newest first, with a filter by card name and type, and opens a chat read-only. Deleting a card archives its chat and preserves the card's last name and type; renaming a card renames its active chat.
- **Pins.** Any assistant response can be pinned (`pinned_messages`). The chat shows a **Pinned reference** selector so a pinned response stays visible above the thread while working elsewhere in the novel.
- **Apply to scene…** opens a review of a response against a chosen scene's prose or plan: current text beside editable proposed text. **Accept replacement** replaces the field and keeps the previous version in History.
- **Suggest cards** (`POST /novels/:id/suggestions/generate`) runs the structuring model over the whole active chat plus the novel's existing cards. It keeps the latest decisions, drops abandoned alternatives and invented facts, follows any extra instruction (for example "only characters"), proposes complete updated bodies for changed cards, and skips unchanged ones. Results are normal suggestions.

---

## 18. Manuscript export

**Export** in the rail opens a dialog (format, and page size for PDF). The current scene is saved first. `GET /api/novels/:id/export?format=…` streams a download named after the novel title.

Content in all formats: the novel title, then chapters in position order, each with its title and the prose of its scenes in position order, separated by `* * *`. Scenes with empty prose are skipped. Plans, notes, beats, style cards, suggestions, and chapterless subplot elements are excluded.

| Format | Details |
|---|---|
| Markdown (`md`) | `# Title`, `## Chapter`, scene prose, `* * *` breaks. Headings are escaped. |
| EPUB (`epub`) | EPUB 3: title page, navigation table of contents, one XHTML file per chapter, a simple serif stylesheet. |
| PDF (`pdf`) | Newsreader font. Title page; each chapter starts on a new page; running header (book title on even pages, chapter title on odd), none on title and chapter-opening pages; centred page numbers. Page sizes: 5 × 8 in, 5.25 × 8 in, 5.5 × 8.5 in (recommended), 6 × 9 in, A5. |
