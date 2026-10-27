# Novel Studio — Product & Technical Specification

Version 1.0 · Reference prototype: `novel-studio.html` (open it in a browser alongside this spec; every screen and interaction described here exists there in mocked form).

This document is written for the engineer or coding agent implementing Novel Studio. It is the source of truth. Where the prototype and this spec disagree, this spec wins.

---

## 0. What we're building

Novel Studio is an open-source, self-hosted writing tool for novelists. A writer develops a novel as a set of linked **cards** (premise, outline, characters, arcs, world, plots, chapters → scenes → beats) and works with an AI **co-writer** that brainstorms, fleshes out, drafts, and checks continuity.

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
| AI providers | Vercel AI SDK (`ai` + provider packages) or a thin in-house adapter (§10) | Uniform streaming + tool/JSON output across providers |
| Client state | Svelte stores + SvelteKit `load` functions | No extra state libraries |
| Editor | Plain `<textarea>` for card fields; CodeMirror 6 for scene prose | CodeMirror handles very long documents with virtualised rendering |

Do **not** use serverless adapters (Vercel, Netlify, Cloudflare). SQLite and the background queue need a persistent process.

```
novel-studio/
  package.json              # "dev": vite dev, "build": vite build, "start": node build
  svelte.config.js          # adapter-node
  src/
    hooks.server.ts         # opens DB, runs migrations, starts background queue, optional password auth
    lib/
      server/               # server-only code (never imported by client)
        db/
          schema.sql        # DDL from §3
          migrate.ts        # applies schema + numbered migrations on boot
          index.ts          # singleton better-sqlite3 connection, pragmas
          repo/*.ts         # one module per table
        ai/
          providers/*.ts    # adapters (§10)
          context/*.ts      # context recipes (§7)
          flows/*.ts        # one file per flow (§8)
          prompts/*.md      # prompt templates (§8.4), imported with ?raw
          structure.ts      # pass 2 + validation + suggestion creation
          tokens.ts         # token estimation + budgeting
        checks/*.ts         # deterministic rule checks (§11)
        queue.ts            # in-process job queue (§1.1)
        crypto.ts           # key encryption (§10.3)
      stores/*.ts           # client UI state (§12)
      components/*.svelte   # IndexCard, TocEntry, Block, Chip, Row, Tag, ThreadLine, SuggestionCard, Dialog, Toast, ProseEditor
      api.ts                # typed fetch helpers for /api routes
    routes/
      +layout.svelte        # three-column shell: Rail | main slot | SidePanel
      +page.svelte          # library / opens last novel
      n/[novelId]/[section]/+page.svelte           # section view
      n/[novelId]/[section]/[cardId]/+page.svelte  # card detail (and ?read=1 for chapter reader)
      api/**/+server.ts     # JSON + SSE endpoints from §6, one file per resource
  static/fonts/             # Newsreader + Manrope, self-hosted
  data/                     # created on first run: novel.db, secret.key (gitignored)
```

Routes give every section and card a real URL (`/n/:novelId/chapters/:cardId`), so browser back/forward and bookmarks work.

### First run

1. `npm install && npm run build && npm start` (or `npm run dev` while developing).
2. On boot, `hooks.server.ts` creates `./data/novel.db` and `./data/secret.key` if missing, runs migrations, and starts the queue. The app listens on `http://127.0.0.1:4317` (`HOST`/`PORT` env vars override; `ORIGIN` must be set when behind a proxy, per adapter-node).
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

The left rail (table of contents) shows seven sections in this fixed order. Each section owns one or more top-level card types.

| # | Section | Top-level types | Child types |
|---|---|---|---|
| 1 | Premise | `premise` | — |
| 2 | Outline | `outline` | — |
| 3 | Characters | `character`, `group`, `relationship` | — |
| 4 | Character arcs | `arc` | — |
| 5 | World & rules | `setting`, `rule`, `object`, `event` | `setting` may nest (galaxy → planet → city) |
| 6 | Grand plot & subplots | `plot`, `secret`, `theme`, `question` | — |
| 7 | Chapters | `chapter` | `scene` (child of chapter), `beat` (child of scene) |

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
| all except chapter | Notes / plan (`body`) | `cards.body` |
| chapter | Purpose, Opens on, Closes on | `fields.purpose`, `fields.opens`, `fields.closes` (body unused, hidden) |
| scene | Scene plan (`body`) + Prose | `cards.body` + `scene_prose` table |
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
| anything else | any → any | Generic link |

`THREAD_LABELS = [opens, advances, resolves, explores]`, `CAST_LABELS = [POV, present, set in, features]`.

### 2.6 Suggestions

Proposed changes from the AI. Actions: `create_card`, `update_card`, `add_link`, `flag_issue`. Each carries a short `what` (headline), `why` (reason), optional `preview` text, and a payload. Lifecycle: `pending → accepted | rejected | stale` (§8.6).

### 2.7 Messages

Each novel has a conversation thread per **scope**. Scope is either a section key (`characters`, `chapters`, …, `flags`) or a card id. Messages store the user's text and the AI's pass-1 response.

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

### Ordering

`position` is a REAL. Inserting between A and B uses `(A+B)/2`. Moving up/down swaps positions with the neighbour. When gaps fall below `1e-9`, renumber siblings `0,1,2…` in one transaction.

### Deletion

Deleting a card cascades to children, links, versions, and pending suggestions targeting it. The UI must confirm deletes that remove children ("Delete chapter and its 4 scenes?"). Deleted cards are not recoverable in v1 (consider soft delete in v2).

---

## 4. Design system

### 4.1 Direction

"A bright book on a desk." Warm paper page, white card stock, dark ink, one ink-blue accent. Cards look like writer's **index cards**. The left rail is a **table of contents**. The chapter reader is a **typeset manuscript page**. Avoid dashboard tropes: no coloured side borders on cards, no gradient washes, no all-caps labels, no per-type colour coding on cards.

### 4.2 Tokens

```
Light (default)
--page        #F3F1EA   app background
--paper       #FFFFFF   panels, cards, dialogs
--ink         #24211C   primary text
--dim         #77716A   secondary text
--line        #E4E0D6   borders, dividers, dotted leaders
--soft        #F8F7F2   chips, inputs, hover
--rule-red    #C9503F   index-card top rule, block heading rule, dialog heading rule
--rule-blue   #DCE6F2   ruled lines behind card snippets
--accent      #2D4F86   buttons, links, active TOC item, user chat bubble
--pending     #E7A93B   counts of things waiting on the writer
--pending-bg  #FDF4E3   suggestion cards
--ok          #3C7A55   Accept buttons, "resolves" label

Dark (prefers-color-scheme: dark — a dim study, not a dashboard)
--page #1B1A17  --paper #26241F  --ink #ECE8DF  --dim #A39D92  --line #3A372F
--soft #2D2A24  --rule-blue #34404F  --accent #8FB0E6  --pending-bg #3A2F1B
```

Thread label colours: opens `#2D6FA8`, advances `#6B4FBF`, resolves `--ok`, explores `#A86E10`.

### 4.3 Typography

- **Newsreader** (serif) for everything that is story: novel title, section titles, card titles, card notes, prose, chat responses, block headings (italic), TOC entries, descriptions.
- **Manrope** (sans) for interface controls: buttons, chips, tabs, small labels, counts, help text.
- Scale: novel title 30 italic; page heading 36; card detail title 36; card title 19; block heading 17 italic; body/notes 16 at 1.7; prose 17.5 at 1.85; reader 18 at 1.85 with 1.5em first-line indent; UI 12–14.
- Ship fonts locally in `web/public/fonts` (open-source licences) so the app works offline.

### 4.4 Layout

Three columns on desktop: **rail 280px | main (flex) | side 330px**. Below 960px: one column with a bottom tab bar (Story / Write / Details) switching between the three.

### 4.5 Components

- **TOC entry:** step number (serif, dim) · section name (serif 17) · dotted leader · count (cards; for Chapters, scene count shown as "6 sc") · amber pending badge. Active: soft background, name italic in accent.
- **Index card:** white, 1px line border, radius 3px, soft paper shadow. Top row: italic subtype left, italic type right. Then a 1.5px red rule. Title (serif 19, semibold). Snippet: 3 lines, serif 14 on 24px ruled blue lines. Footer meta: child count ("3 scenes"), link count, amber pending badge. Hover: accent border, lift 1px (disabled under reduced motion).
- **New card tile:** dashed border, italic "+ New card" / "+ New chapter".
- **Block:** index-card panel used on detail pages; heading italic serif with a red rule under it.
- **Chip:** pill buttons for AI actions.
- **Row:** a compact index card with ↑/↓ reorder buttons on the left (used for scenes and beats).
- **Tag:** pill with serif name and italic label (cast in a scene).
- **Thread line:** title button · coloured label pill · italic "in <scene>".
- **Suggestion card:** pending-bg, amber border; "On <card>" line when shown outside its card; headline (serif semibold), reason (small dim), preview (serif on white), actions. For `flag_issue`: **Apply fix** + **It's intentional**. Otherwise: **Accept** (green) + **Dismiss**.
- **Dialog:** paper, red rule under heading, italic lead line.
- **Toast:** ink background, paper text, bottom centre, 1.8s.

### 4.6 Copy rules

Sentence case. Plain verbs. Buttons say what they do ("Create novel", "Apply fix", "Read whole chapter"). Empty states invite action ("No scenes yet. Brainstorm some from the chapter plan."). Errors say what happened and how to fix it ("The provider rejected the API key. Check it in Settings.").

---

## 5. Screens and features (everything in the prototype)

### 5.1 Rail (left)

1. **Novel switcher.** The novel title is a button with a ▾. It opens a menu listing all novels (current one italic, "open now"; others show their tagline), a divider, and **+ New novel**. Selecting a novel loads it and opens Chapters if it has content, otherwise Premise. Last-opened novel opens on app start.
2. **New novel dialog.** Fields: Working title (default "Untitled novel"), Premise in a sentence (optional). **Create novel** creates the novel and, if a premise was given, a `premise` card. Opens the Premise section.
3. **Contents (TOC).** The seven sections (§2.3) in order. Clicking opens the section view. Badges show pending suggestions for all cards in that section, including descendants.
4. **Continuity check button.** Shows the count of pending `flag_issue` suggestions across the novel ("Issues to review" / "All clear"). Opens the Continuity view.
5. **Settings button.** Opens Settings (§5.6).

### 5.2 Main: section view

- Header: "Step N of 7", section name, one-line description.
- Card grid. Multi-type sections are grouped with italic group headings (Characters / Groups / Relationships; Settings / Rules / Objects / Timeline events; Plots / Secrets / Themes / Open questions). Chapters are ordered by position.
- **+ New card** tile focuses the composer with placeholder "Describe it in your own words, and I'll suggest the card…". Cards are created through the co-writer (capture flow) or, as a fallback, a "Blank card" option in a small menu on the tile (type picker + title) for users without a provider.
- Composer is scoped to the section (placeholder "Brainstorm characters…"). Before the first message, quick-prompt chips appear (e.g. "Brainstorm antagonists who want the relay shut down.").

### 5.3 Main: card detail

Header: breadcrumb "← All <section>" then each ancestor (chapter / scene) as a link; italic "type, subtype"; editable title (serif 36). Saves on blur.

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
  - **Threads in this chapter**: all thread links from the chapter and its descendants, each with label and "in <scene>".
  - **Scenes**: reorderable rows. Chips: *Read whole chapter*, *Check chapter continuity*.
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

All text fields save on blur (debounced 600ms while typing for prose; see §9.3) and create a version.

### 5.4 Main: continuity view

Header "Story issues". Grid of every card with a pending `flag_issue`. Side panel lists all flags. Composer here runs the **Ask** flow (read-only Q&A, e.g. "Where is Kira in chapter 2?").

### 5.5 Conversation dock (bottom of main)

- Thread of messages for the current scope (section or card). User messages: accent bubble right. AI messages: serif prose left.
- While a turn runs, the AI message shows "Writing…" (streaming pass-1 text as it arrives), then "Structuring into cards…", then "**N suggestions** ready for review on the right" or "No card changes suggested".
- Composer: Enter sends, Shift+Enter newline. Placeholder reflects scope.
- Clicking an AI chip on a card starts a turn in that card's thread with no visible user message (the chip label is stored as the user message with `role=user` and a `chip` flag, rendered as a small italic line, e.g. "↳ Flesh out backstory").

### 5.6 Side panel (right)

- Scope header: "Selected card <title>" or "Showing everything in <section>".
- On a section: **Suggestions** only (all pending for cards in the section plus pending `create_card` suggestions raised in that section).
- On a card: tabs **Suggestions** (for the card and its descendants), **Links** (both directions, label, click to open), **History** (versions newest first, each with **Restore**).
- Suggestions outside their own card show "On <card>". Accepting/dismissing updates counts everywhere immediately.

### 5.7 Settings dialog

- **Provider**: Anthropic, OpenAI, Google Gemini, OpenRouter, Ollama (local), OpenAI-compatible.
- **API key**: password input. Hidden for Ollama ("No key needed for a local Ollama server.").
- **Base URL**: shown for Ollama and OpenAI-compatible.
- **Writing model** and **Structuring model**: selects populated from the provider's model list endpoint where available (§10.2), with a free-text "Other…" option.
- Help line: "Writing model drafts prose and ideas. Structuring model turns responses into card suggestions; a smaller, cheaper model is fine."
- **Test connection**: sends a tiny request to each model; shows "Connected. Both models respond." or the provider's error in plain words.
- **Save**. Advanced (collapsed): context budget (§7.5), temperature for writing model (default 0.9) and structuring model (default 0).

### 5.8 Mobile

Bottom tabs Story / Write / Details. Selecting a section or card switches to Write. When suggestions arrive while on Write, toast "N suggestions in Details".

---

## 6. HTTP API

JSON over REST under `/api`. Streaming via Server-Sent Events. All ids are ULIDs. All mutating endpoints return the updated entity plus any side-effects (e.g. `{card, version}`).

### Novels
```
GET    /api/novels                         → [{id,title,tagline,updated_at,last_opened_at}]
POST   /api/novels {title, premise?}       → {novel, premiseCard?}
PATCH  /api/novels/:id {title?, tagline?}
DELETE /api/novels/:id
POST   /api/novels/:id/open                → sets last_opened_at
GET    /api/novels/:id/overview            → {sections:[{key,count,sceneCount?,pending}], flagsPending}
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
DELETE /api/cards/:cardId
GET    /api/cards/:cardId/read                          → stitched chapter for reader: [{sceneId,title,prose}] (paged for long chapters)
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
GET    /api/novels/:id/messages?scope=…        → thread for scope
POST   /api/novels/:id/turns {scope, flow, text?}   → {turnId}
GET    /api/turns/:turnId/stream               → SSE: event: text (delta) | phase (writing|structuring) | suggestions (array) | done | error
```

### Suggestions
```
GET    /api/novels/:id/suggestions?scope=…&cardId=…&status=pending
POST   /api/suggestions/:id/accept {edits?}    → applies (§8.6). `edits` lets the user tweak preview text before accepting.
POST   /api/suggestions/:id/reject             → marks rejected, records rejection fingerprint
POST   /api/suggestions/accept-batch {ids:[]}
```

### Checks and settings
```
POST   /api/novels/:id/checks/run              → runs deterministic checks (§11), returns new flags
GET    /api/settings                           → provider, models, baseUrl, hasKey (never returns key)
PUT    /api/settings {provider, apiKey?, baseUrl?, modelWrite, modelStruct, budget?, temps?}
POST   /api/settings/test                      → {ok, write:{ok,msg}, struct:{ok,msg}}
GET    /api/settings/models?provider&baseUrl   → model list from provider
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
- Flows marked **read-only** (`ask`, `earned`) skip pass 2.
- Cancellation: client closes SSE → server aborts the provider request; turn status `error`, message "Stopped."

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
| free chat on a card | Composer while a card is open | card | any action relevant to that card |

Free-text messages in a scope are classified by the server: in a section → `capture`/`brainstorm` (the pass-1 prompt handles both; no classifier needed); on a card → `card_chat` using the `flesh` recipe plus `thread`.

### 8.3 Link candidates (no blind text matching)

For `links` and `who`, the server prepares a **candidate list** before calling the model:

1. Gather the card's text (body, fields, and for scenes, prose head 2k + any FTS hits).
2. Find mentions of every other card's title and aliases using case-insensitive whole-word matching, plus first-name-only matches for characters.
3. Exclude pairs already linked and pairs in `rejections`.
4. Send the candidates (with the matching sentence) to the model and ask it to confirm or reject each and pick a label, and to add any **implied** links it sees (e.g. "the Admiral" → Admiral Haas via alias or context).
5. Every result becomes an `add_link` suggestion. Nothing is linked until the writer accepts.

### 8.4 Prompts

Prompts live in `server/src/ai/prompts/*.md` as templates with `{{placeholders}}`. All pass-1 prompts share a system preamble:

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
   - `update_card` with `replace`, or `flag_issue` with a `replace` fix: mark `stale`, return 409 with `{reason:"changed"}`; the UI shows "This card changed since the suggestion was made" with **Apply anyway** (re-POST with `force:true`) or **Dismiss**.
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
- Model dropdowns are filled from `listModels()`; a free-text "Other…" is always available (providers add models faster than lists update).
- A small built-in table in `providers/models.ts` provides context windows for well-known models; unknown → 32k (user can override in Advanced).

### 10.3 Key storage

- On first run, generate a 32-byte random `./data/secret.key` (file mode 600).
- Store API keys in `settings` encrypted with AES-256-GCM using that key. `GET /api/settings` returns `hasKey: true`, never the key.
- Keys are only ever sent to the selected provider's endpoint.
- Server binds to `127.0.0.1` by default. If `HOST` is set to a public interface, require `NOVEL_STUDIO_PASSWORD` (simple session cookie auth); refuse to start otherwise, with a clear message.

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

Log every check result (including passes) in a `check_runs` table (optional) — this is the data source for the future game layer.

---

## 12. Client architecture notes

- **API style.** Use `+server.ts` JSON endpoints for everything in §6, not form actions. Streaming turns and accept/reject need endpoints anyway, and a stable JSON API keeps the door open for other clients later. Page `load` functions call the same repository functions directly on the server for the initial render.
- **State.** Svelte stores in `src/lib/stores/`:
  - `ui` (writable): current novel, section, card, side tab, reading mode, mobile tab, menu/dialog open state.
  - `suggestions` (writable, keyed by novel): pending suggestions; refreshed after any turn or accept/reject. Derived stores compute badge counts per card and per section so TOC, cards, and side panel stay in sync.
  - `threads` (writable, keyed by scope): messages, including the in-progress streaming assistant message.
  - Cards, links, and versions come from `load` + `invalidate()` after mutations. Use optimistic updates for reorder and accept/reject; roll back on error.
- **Streaming.** One `EventSource` per active turn (`/api/turns/:id/stream`). Append `text` deltas to the in-progress message in the `threads` store; on `suggestions`, refresh the `suggestions` store and `invalidate` affected card data.
- **Prose editor.** Wrap CodeMirror 6 in a `ProseEditor.svelte` component. Mount on the client only (`onMount`). Debounced saves per §9.3.
- **Keyboard.** Enter send, Shift+Enter newline, Esc closes menus/dialogs, `⌘K`/`Ctrl+K` card search (FTS) — optional v1.1.
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
Mobile layout, dark mode, empty states, error copy, export (Markdown/DOCX of the manuscript — optional), README with screenshots.

---

## 14. Out of scope for v1 (parked by decision)

- The game layer (board view, alert feed, quests). Rule-check logging (§11) is collected now to inform it.
- Optional method overlays (Snowflake, Save the Cat, Hero's Journey).
- Merging two brainstormed ideas into one card (add in v1.1: select two pending `create_card` suggestions → "Merge" runs a small flow that writes a combined card).
- Collaboration, multi-user, cloud sync.
- Maps and relationship graph visualisations.
