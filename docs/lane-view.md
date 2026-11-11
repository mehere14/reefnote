# Lane grid

Open **Lane grid** from Contents (under *Views*) or from **Book sections ▾**. The grid shows the threads you follow as rows and story time as columns. Read a row left to right to follow one thread; read a column top to bottom to see everything that happens at that moment. Nothing on the grid uses the AI. Every move applies immediately and is kept in the card's History.

**Lanes.** Choose **+ Add lane** and pick any card: a plot, character, group, setting, object, question, secret, theme or event. You can also create a new card there. A new plot is created as a real subplot, so it works in subplot mode too. Removing a lane keeps the card and sends its beats back to the tray. Use ↑ and ↓ to reorder lanes and **Fold** to shrink one.

**Beats and turning points.** A plot lane lists its turning points in the tray below the grid. Drag one onto a column to place it. This creates a beat card linked to the turning point, and editing either one updates the other. Editing the beat sends the turning point back to draft, with the same review badges as editing it in subplot mode. Quick-add a beat with **+** in an empty cell or **+ Beat** at the end of a lane. Beats can stay loose; they don't need a scene or chapter.

**Columns.** Drop a beat on a column to share that moment, or on the thin gap between columns to start a new one. A column's label is any free-text time label you give a beat there ("Spring 2187"); otherwise it's numbered. Nothing parses dates.

**Scenes and collisions.** Drop one beat on another to make them one scene. If the target beat is already in a scene, the dropped beat joins it. A scene whose beats sit on two or more lanes is a **collision**: one event that turns several threads at once. A bracket joins the beats and shows "read in Ch N" once the scene is in a chapter. Drag the bracket's label to move the whole scene. Dragging one of its beats to a different column takes that beat out of the scene. **Take out of scene** in the beat panel does the same and leaves the beat where it is. Deleting a scene keeps its lane beats and turning-point beats as loose beats; only its other beats are deleted.

**Backstory.** Everything left of the dashed **Chapter 1 starts** line happened before the story. It's compressed to one column until you choose **Expand backstory**. **+** in that column creates a backstory event. In the beat panel, **Because of** links a present beat to the backstory that drives it. Hovering the beat draws a line back to it. **Touches** marks a beat as also affecting another lane, which shows a faint marker in that lane's row.

**A backstory plot.** A long backstory written as a plot (its own premise, turning points and scenes) becomes its own lane. It doesn't have to be its own lane: on any lane (a faction, a character), **+** in the backstory offers **Or choose existing backstory…**, listing each plot's unplaced turning points and a **Whole plot** choice that places all of them on that lane in story order, followed by events and loose beats. Or add the plot as a lane and choose **All into backstory** in its tray: every turning point gets its own column before Chapter 1, in story order (**All at the end** does the same after the last column). Drop one backstory beat on another to make a backstory scene. To tie the present to it, click a scene's label on the grid (or the scene name in a beat's panel). The scene panel's **Because of** links the scene to the whole backstory plot, to one backstory scene, to a single turning point, or to an event. Beats have the same picker. Hovering the scene label draws a line to each cause. Outside the grid, the Studio link dialog also offers `because of` for any scene, including scenes not yet on the grid.

**Signals.** A lane that goes quiet for more than four columns (change the number in the toolbar) gets hatched cells, and "Quiet for N columns" if it never comes back. A column holding more than three beats is marked **Crowded**. These are hints. Nothing is enforced.

**Keyboard and phone.** Arrow keys move between beats; Enter opens the selected card. On a phone the grid shows one lane at a time with a lane switcher. Move beats from the beat panel's Lane and Column selectors.

Chapter slices, the chapter Layout tab and lane-aware drafting come in the next phases (`docs/lane-view-plan.md`).

## Verification

- `npm test`: `tests/lanes.test.ts` covers the idempotent migration, parentless beats in core and in structure validation, slot midpoints and renumbering, backstory and present regions, the turning point bridge in both directions with review badges, placement versioning and restore, stale `baseRev`, lane and card deletion, grouping, joining, moving and ungrouping scenes, scene deletion releasing lane beats, laying out a backstory plot in story order, scene-level `because of` links to a whole plot, a backstory scene and a turning point, and the grid API.
- `npm run check` and `npm run build`.
- `node scripts/smoke-lanes.mjs`: browser check against an isolated test server at `http://127.0.0.1:4318` (override with `REEFNOTE_TEST_URL`). Covers navigation, adding a lane, the turning point tray and bridge, a collision across reload, backstory, the phone view, and subplot mode. Don't point it at the live writing database.
