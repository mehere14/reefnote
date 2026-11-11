// Shared lane constants (client and server). See docs/lane-view-plan.md §3.
/** beat or scene → its backstory cause: a backstory plot, beat, turning point, scene or event ("this happens because of X"). */
export const BECAUSE_OF='because of';
/** beat → another lane's card: renders a ghost marker on that lane. */
export const TOUCHES='touches';
export const LANE_LINK_LABELS=[BECAUSE_OF,TOUCHES] as const;
/** Card types that can be placed on a lane. Events are backstory or off-page beats. */
export const PLACEABLE_TYPES=['beat','event'];
/** Card types that cannot be followed as a lane (they are the grid's own structure). */
export const NON_LANE_TYPES=['chapter','scene','beat','style'];
/** Colour tokens --lane-1 … --lane-8 in styles.css. */
export const LANE_COLORS=Array.from({length:8},(_,i)=>`lane-${i+1}`);
/** Default number of columns a lane may stay silent before it is flagged as cold. */
export const COLD_AFTER=4;
/** Beats in one column above which the column is flagged as a pileup. */
export const PILEUP_OVER=3;
