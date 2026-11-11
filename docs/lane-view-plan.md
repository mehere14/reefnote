# Reefnote: lane grid, chapter layout, and lane-aware co-writer — implementation plan

Status: approved design, ready to implement (2026-11-08).
Read `docs/subplot-mode.md`, `SPEC.md` §2, §3.1, §7, §8, §16 first. This plan builds on the existing model. Do not create a parallel data model.

## 0. Why (short version)

The writer plots each thread separately (lanes, read horizontally) and writes chapter by chapter (columns, read vertically). The grid shows both. Writers' room method: plot threads separately, braid them into scenes, write the scenes already interwoven. Collisions (one scene that is a different turning point for two or more threads) make the book feel busy and deep at the same time.

Vocabulary used below:
- **Lane**: one thread followed across story time. It points at any card (plot, character, group, setting, object, question, secret, custom type).
- **Beat**: a turning point. Something changes. Beats are `beat` cards.
- **Scene**: a continuous moment. It groups one or more beats (children). A scene whose beats sit on 2+ lanes is a **collision**.
- **Chapter**: a slice of scenes in reading order.
- **Slot**: a beat's position in story time (shared x-axis).

Non-negotiables (existing Reefnote principles):
- Flexible, never enforced. Any order of work.
- Every AI change is a suggestion the writer approves (new lanes, placements, links, beats, characters, prose).
- Two-pass AI (free text, then structuring into suggestions).
- Typed cards plus links. Free text, not forms.

## 1. Current model (verified against code and the live DB)

- `cards` (type, subtype, title, body, fields JSON, parent_id, position REAL, rev). chapter → scene → beat via parent_id.
- `links` card → card, free label. `suggestions` act on card ids only.
- `subplots` table holds plots. Every subplot has a backing `plot` card via `plot_sources` (0 orphans in live data). New subplots create one in `subplots/service.ts`.
- `turning_points` (per subplot, own table, not cards).
- `elements`: subplot metadata on a scene card (subplot_id, turning_point_id, position, time_marker, summary, status, prose_state). Scenes may be chapterless.
- `element_links` has `shares_scene_with` (unused).
- Beat cards must have a scene parent (`core.ts` line ~26, `ai/structure.ts` line ~50).
- Live novel "The Andicoralians": 5 plots, 10 turning points, 18 scenes (14 elements, all chapterless), 1 chapter, 0 beat cards, 0 time markers.

### Co-writer context today (`src/lib/server/ai/context/index.ts`)
Two separate paths:
1. **Subplot path**: scope is a subplot, turning point, or a subplot element scene (flows scene_draft, card_chat, capture, brainstorm, ask). Sends JSON with the plot, its turning points, and **every scene of that one plot with full prose** (`proseContext` in `subplots/generation.ts`). Only one plot's continuity. No awareness of other threads in the same scene. Cost grows with the plot.
2. **Card path** (`assemble` recipes): reading order is derived from chapter order then scene position. `previous` = previous scene tail, `next` = next scene, `chapter` = earlier scenes in chapter (digest), `story` = earlier chapters (digest), `cast` from POV/present/set in/features links, `threads` from opens/advances/resolves/explores links. `draft` drafts beat by beat when a scene has >1 beat. `chapter_draft` (`ai/chapter-draft.ts`) drafts each scene in order, chaining `previousDraft`.

Gaps for lanes:
- Neither path knows which lanes a scene's beats belong to, or where each thread was last left.
- Chapterless scenes sort with chapter index -1 in the card path, so "previous/next" is wrong for them.
- No distinction between what the **reader** has seen (reading order) and what **characters** know (story time). Flashbacks and backstory break this.
- Backstory is either absent or dumped. It should leak in fragments when the present demands it.

## 2. Decisions (approved)

1. X-axis = story time. Reading order = chapter slices (scene.parent_id = chapter, scene.position). Flashback scenes sit at their story-time slot with a "read in Ch N" badge.
2. Plot membership = lane placement. A turning point's beat goes on its plot's lane by default. Secondary lanes use a `touches` link.
3. Collision = one shared scene card with per-lane child beats.
4. No standalone beats exist yet. Rule: a beat under a scene renders in that scene's column once it has a lane; otherwise it is in the tray.
5. Ordinal slots (REAL, insert-between like `position`, renumber on gaps < 1e-9) plus an optional free-text `time_label`. No date parsing.

## 3. Schema (new idempotent migration `src/lib/server/db/lane-schema.ts`, called from `db/index.ts` like `migrateSubplots`)

```sql
CREATE TABLE IF NOT EXISTS lanes(
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  position REAL NOT NULL,
  color TEXT NOT NULL DEFAULT '',
  collapsed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(novel_id, card_id));

CREATE TABLE IF NOT EXISTS beat_placements(
  beat_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  slot REAL,                         -- story time; NULL = parked in this lane's tray; < 0 = backstory
  time_label TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS beat_placements_lane ON beat_placements(lane_id, slot);

CREATE TABLE IF NOT EXISTS turning_point_beats(
  turning_point_id TEXT PRIMARY KEY REFERENCES turning_points(id) ON DELETE CASCADE,
  beat_id TEXT NOT NULL UNIQUE REFERENCES cards(id) ON DELETE CASCADE);
```

Rule changes:
- Beat cards may be parentless (floating) or under a scene. Update `core.ts` parent validation and `ai/structure.ts` reference validation. Placed beats can also be `event` cards (backstory subtype) in the backstory region.
- All beats under one scene share the scene's slot. Service keeps them in sync: moving a scene moves its beats; adding a beat to a scene adopts the scene's slot. Scene slot is derived (min slot of its beats), not stored.
- Turning point ↔ beat card: created on first placement. Two-way text sync, same pattern as `syncPlotCard` in `db/plot-migration.ts` (turning point `text` ↔ beat `body`, title = first line). Editing either bumps rev and triggers existing review badges.
- Lane delete: placements cascade, beats return to the global tray. Card delete: lane cascades.

New link labels (add to SPEC §2.5 and constants next to `THREAD_LABELS`/`CAST_LABELS`):
- `because of`: beat → backstory beat or event. "This happens because of X."
- `touches`: beat → another lane's card. Renders a ghost marker on that lane.
- `in lane` is NOT a link. Lane membership lives in `beat_placements`.

Lane colour: reuse the existing thread colour-coding if available, else assign from a fixed palette on create.

## 4. Grid view (phase 1)

Route: `src/routes/n/[novelId]/lanes/+page.svelte` plus a "Lanes" entry in the book navigation. Desktop first; on phone show one lane at a time with a lane switcher (match existing mobile patterns, SPEC §5.9).

- Rows = lanes (ordered by `lanes.position`). Header shows the lane card title and type. Click opens the card.
- "Add lane" picker: any card in the novel, grouped by type, plus "new card" (create card of any type, then lane).
- Columns = distinct slots. Beats render as compact cards. A scene renders as a vertical bracket joining its beats across lanes (the collision).
- Backstory region left of a "Chapter 1 starts" divider (slot < 0). Compressed by default, expandable.
- Chapter slices drawn as shaded bands on top once they exist (phase 2).
- Tray (bottom or side): unplaced beats, grouped by lane (slot NULL) plus a "no lane" group. Unplaced turning points show under their plot's lane automatically (virtual, until placed).
- Interactions: drag beat between slots and lanes; drop between two columns = new slot (midpoint); drop onto an existing column = same slot; drag beat onto another beat = "make a scene together" (creates a scene card, both become children). Quick-add beat inline on a lane cell. Keyboard: arrows move selection, Enter opens.
- Signals (computed, no schema): lane cold for > N columns (configurable, default 4), empty stretches, pileups (> 3 beats in one column).
- `because of` links render as a thin line from a present beat back into the backstory region on hover.

API (add to `routes/api/[...path]/+server.ts` via a `handleLanes` module `src/lib/server/lanes/api.ts`, mirroring `handleSubplots`):
```
GET    /api/novels/:id/grid            → {lanes, placements, beats (cards), scenes, chapters, turningPoints(unplaced), links(because of, touches)}
POST   /api/novels/:id/lanes {card_id | new_card:{type,title,body}}
PATCH  /api/lanes/:id {position?, color?, collapsed?}
DELETE /api/lanes/:id
PUT    /api/beats/:id/placement {lane_id, slot|null, time_label?}   (beat_id may be a turning point id → creates bridge beat)
DELETE /api/beats/:id/placement
POST   /api/novels/:id/beats {title, body, subtype?, lane_id?, slot?, scene_id?}
POST   /api/scenes/group {beat_ids[], title?}  → new scene card, beats reparented, shared slot
POST   /api/scenes/:id/ungroup {beat_id}
```
All writes are user actions (direct), versioned via existing `versions`. Concurrency: use `rev`/`baseRev` like the rest of the API.

## 5. Chapter layout (phase 2): "create or pull in beats, then click into a scene"

Two entry points, one model (chapter = scene.parent_id):

**A. From the grid (slice):** lasso or shift-select columns or beats → "Make chapter" (new or existing chapter card).
- Beats already in scenes: those scenes get parent = chapter.
- Loose beats: one scene per column by default (beats in the same column become one collision scene). Writer can split before confirming. Show a confirm preview: "Creates 3 scenes in Chapter 4".
- Scene reading order defaults to slot order. Writer can reorder in the chapter (cutting on tension); story slots don't change.

**B. From the chapter card (layout tab):** a new **Layout** tab on the chapter detail (next to existing chapter fields). It is the grid zoomed to this chapter's columns:
- Columns = this chapter's scenes in reading order. Rows = lanes those scenes touch, plus "+ lane".
- **Pull in**: side panel listing tray beats and placed-but-unsliced beats near this chapter's story-time window (nearest first, filter by lane). Drag into a scene column or into a gap (creates a scene).
- **Create**: quick-add beat directly in a cell (gets that lane and the column's slot; new column gets a slot between neighbours).
- Chapter fields stay visible: Purpose, Opens on, Closes on. A "hook" hint: the last scene's last beat per lane is marked "left on" (what question the reader carries out).
- Each scene column has **Open scene** → existing scene detail (Plan / Prose). **Draft with AI** on a scene, and **Draft chapter** on the chapter (existing `chapter_draft`), both use the lane-aware context below.

Scene plan seeding: when a scene is created from beats, its plan body is empty. Show the chip "Plan from beats" (new flow `scene_from_beats`) that suggests a plan (goal / conflict / outcome) weaving the beats. Suggestion, approved by the writer. Writer can also just type or go straight to Prose.

Manuscript export already uses chapters → scenes, so sliced scenes export with no change. Unsliced scenes stay excluded (current behaviour).

## 6. Lane-aware co-writer context (phase 2, ship with chapter layout)

Goal: when writing any scene that has beats on lanes, the model knows every thread in the scene, where each was left, where each goes next, what backstory is in play, and what the reader versus the characters know. Without dumping whole plots.

### 6.1 Routing
In `assemble`, decide the path:
- If the scope scene (or the scene of a scoped beat) has any placed beat → **card path with lane items** (below), for flows `draft`, `dialogue`, `card_chat`, `brainstorm`, `beats`, `check`, `chapter_draft`, `scene_from_beats`, and the new grid flows. This applies even when the scene is also a subplot element. Element data (subplot premise, turning point, element purpose/summary) is included through the plot lane item instead of the subplot JSON path.
- Otherwise behaviour is unchanged (subplot path for elements, card path for the rest). Subplot-mode screens keep their path.
- Fix ordering: reading order = chaptered scenes only (chapter order, then position). Chapterless scenes are never "previous/next" in reading order. For them, use story-time order (slot) for continuity and say so in the prompt.

### 6.2 New context items (add to `items()` switch)
| Item | Content | Default form |
|---|---|---|
| `scene_lanes` | For each beat in the scene: the beat (full), its lane card (full for plots/characters/groups/questions, digest otherwise), turning-point text if bridged, `touches` lanes (ref). Labelled "This scene is beat X on lane A". | full |
| `lane_so_far` | Per lane in the scene: that lane's earlier beats by story time (titles + one line each), plus the **last scene where this lane appeared**: its summary/digest plus its prose tail (~600 tokens) labelled "Where this thread was left". | digest + tail |
| `lane_next` | Per lane: the next 1–2 beats on that lane by story time (full) so the draft sets them up but does not perform them. | full |
| `backstory_in_play` | Backstory beats/events linked by `because of` from this scene's beats (full), plus lane backstory beats (digest). Labelled with the reveal instruction below. | full / digest |
| `reader_so_far` | Reading-order context: previous scene tail (existing `previous`), chapter purpose/opens/closes, earlier scenes in this chapter (digest), earlier chapters (digest). Unchanged items, renamed in the prompt header. | existing |
| `knowledge_guard` | Only when the scene's story-time slot is earlier than scenes the reader has already read (flashback), or later scenes exist in story time but earlier in reading: a short list "Reader already knows: …" / "Characters here do not yet know: …" built from beat titles on both sides. | text |
| `chapter_role` | Position in chapter (first, middle, last). If last: "End on an open question for lane(s) …". If a lane in this scene does not appear again for N chapters: "Leave lane A on tension." | text |
| `element_meta` | If the scene is a subplot element: purpose, target_length, time_marker, secret actions from `element_cards` (introduced/hinted/revealed). | full |

### 6.3 Recipes
```
draft:      P0 self, children(beats full), scene_lanes, cast, previous, chapter_role
            P1 lane_so_far, lane_next, backstory_in_play, ancestors, element_meta, rules
            P2 knowledge_guard, chapter, story, threads, next
            P3 thread
chapter_draft: same as draft per scene (already calls assemble per scene with previousDraft)
dialogue:   P0 self, cast (voice notes), prose_tail, scene_lanes
            P1 children, previous, lane_so_far   P2 rules, backstory_in_play   P3 thread
card_chat / brainstorm on a lane scene: P0 user, self, scene_lanes  P1 lane_so_far, lane_next, linked, thread  P2 backstory_in_play, rules, outline
scene_from_beats: P0 self, children, scene_lanes, cast  P1 lane_so_far, lane_next, backstory_in_play, chapter_role  P2 chapter, rules
beats (suggest beats for a scene): add scene_lanes to P0, lane_so_far to P1
```
Budget rules: keep existing degrade order (full → digest → ref). `lane_so_far` and `lane_next` must degrade per lane evenly, never dropping a whole lane before others are digested. P0 must fit or the request fails with a clear message (same rule as `chapter-draft.ts` "plan exceeds the context budget"). Required-full items for draft: scene plan, its beats, chapter card.

Never send all prose of a plot. The subplot path's "every plot scene with full prose" stays only for subplot-mode screens.

### 6.4 Prompt changes (`ai/flows/index.ts`, `prompt-defaults.ts`)
Add to draft / chapter_draft / scene_from_beats instructions:
- "This scene carries these beats: [lane: beat]. Each beat must land: something changes for that thread. If beats belong to different lanes, the same event means something different to each thread. Show both."
- "Continue each thread from where it was left. Do not re-explain earlier scenes."
- "Set up but do not perform the next beats listed under lane_next."
- "Backstory is pressure, not exposition. Reveal it only in fragments the present forces out (a line of dialogue, a choice, an argument). Never summarise backstory."
- "Respect the knowledge guard: characters only know what has happened by this point in story time."
- Chapter-last scene: "End on an open question."
- Draft beat by beat (existing behaviour when >1 beat), ordered by beat position inside the scene. Insert a short transition between beats from different lanes, not a scene break.

Style: the card path already applies style layers for draft/dialogue/card_chat/capture. Ensure lane-routed element scenes now get style through this path (today the subplot path passes style only inside `proseContext`).

### 6.5 Manifest and visibility
Every new item records manifest entries (`card_id`, form, tokens), e.g. form `lane so far: <lane title>`, `where thread was left`, `knowledge guard`. The existing "Context used" line then shows which lanes were sent. Add a compact lane chip row to the draft proposal header.

## 7. AI ideation (phase 3)

All outputs are suggestions (pass 2 structuring into `create_card`, `add_link`, plus new actions below). Rejections fingerprinted as today.

New suggestion actions (extend `suggestions.action` handling in `structure.ts` and the apply step):
- `create_lane {card_id | new card}`.
- `place_beat {beat (new or id), lane_id, slot | after_beat_id}`.
- `group_scene {beat_ids}`.

Flows:
- `cast_from_plot` (plots space): given a plot card/subplot, suggest characters and groups **by story function**: drives the conflict, opposes it, pays the cost, sees it differently, caught in the middle, knows the truth. Output `create_card` (+ optional `create_lane`).
- `who_else` (grid, from a beat or scene): "who else is in this scene?" Suggest existing cards (as cast links) or new characters/groups (create_card, optional create_lane). Context: scene_lanes, lane_so_far, all characters/groups as ref.
- `collide` (grid, select two lanes): propose 2–3 collision scenes (one event, a different beat for each lane) at plausible slots. Output beats + group_scene + place_beat.
- `fill_gap` (grid, on a cold lane or empty stretch): propose beats to bridge, placed on that lane.
- `slice_chapters` (grid): propose chapter boundaries over a selected range, ending each on a hook. Output = proposed slices shown as bands; accepting runs the same slice operation as §5A.

## 8. Build order and acceptance

**Phase 1: grid (read / place / move)**
- Migration, rule changes, lanes API, grid page, tray, backstory region, scene grouping, turning point bridging.
- Accept: on The Andicoralians copy, add lanes for 3 plots + 1 character + 1 question card; turning points appear in their plot trays; place them; drag across slots and lanes; group two beats into a collision scene; place a backstory event at slot < 0 and link `because of`; reload persists; subplot mode still works unchanged.

**Phase 2: chapter layout + lane-aware context**
- Slice from grid; chapter Layout tab with Pull in / Create; Open scene; Plan from beats; draft scene and draft chapter with lane-aware context; manifest shows lanes.
- Accept: create a chapter from 4 columns across 3 lanes; reorder scenes in the chapter without changing slots; open a collision scene, "Plan from beats" → approve → "Draft with AI" → proposal mentions both threads' turns; manifest lists `scene_lanes`, `lane_so_far` for each lane, `backstory_in_play`; draft chapter drafts all scenes in order; export includes the chapter.

**Phase 3: AI ideation** (cast_from_plot, who_else, collide, fill_gap, slice_chapters). All approval-gated.

## 9. Tests (vitest, `tests/lanes.test.ts`, `tests/lane-context.test.ts`; never point smoke tests at the live DB)
- Placement: slot midpoint insert and renumber; scene shared slot sync; lane delete returns beats to tray; turning point bridge two-way sync.
- Parentless beat allowed in core and in structure validation.
- Context: collision scene includes both lanes' `lane_so_far` and `lane_next`; flashback scene gets `knowledge_guard` and excludes later story-time beats from "characters know"; chapterless scene never used as reading-order previous; budget degrades lanes evenly; P0 overflow throws the clear error; element scene routed to lane path gets style layers; subplot-mode screen context unchanged (snapshot test against current `proseContext` output).
- Suggestions: create_lane, place_beat, group_scene apply and reject correctly with fingerprints.
- Smoke: extend `scripts/smoke-unified.mjs` with a grid flow against the isolated test server (port 4318).

## 10. Docs to update when done
`SPEC.md` (§2.3 beats parent rule, §2.5 labels, §3.1 tables, §5 new screens, §6 API, §7 items/recipes, §8 flows), `README.md` feature list, new `docs/lane-view.md` user guide in the style of `docs/subplot-mode.md`.
