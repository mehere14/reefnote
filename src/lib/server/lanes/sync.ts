import db from '../db';
/**
 * Database-only lane helpers used by core.ts. They must not import core (core imports them),
 * mirroring how db/plot-migration.ts keeps syncPlotCard free of core imports.
 */

export type Placement={lane_id:string;slot:number|null;time_label:string};

export function placementOf(beatId:string):Placement|null{
 return (db.prepare('SELECT lane_id,slot,time_label FROM beat_placements WHERE beat_id=?').get(beatId) as Placement|undefined)||null;
}

/** Captured into card versions so History → Restore also restores a beat's lane and slot. */
export function placementSnapshot(cardId:string){
 const card=db.prepare('SELECT type FROM cards WHERE id=?').get(cardId) as any;
 if(!card||!['beat','event'].includes(card.type))return undefined;
 return placementOf(cardId);
}

export function restorePlacement(cardId:string,saved:Placement|null|undefined){
 if(saved===undefined)return;
 if(!saved||!db.prepare('SELECT id FROM lanes WHERE id=?').get(saved.lane_id)){db.prepare('DELETE FROM beat_placements WHERE beat_id=?').run(cardId);return;}
 db.prepare('INSERT INTO beat_placements(beat_id,lane_id,slot,time_label) VALUES(?,?,?,?) ON CONFLICT(beat_id) DO UPDATE SET lane_id=excluded.lane_id,slot=excluded.slot,time_label=excluded.time_label').run(cardId,saved.lane_id,saved.slot,saved.time_label||'');
}

/** The scene's column: the shared slot of its placed beats (derived, never stored). */
export function sceneSlot(sceneId:string,exceptBeat=''):number|null{
 const row=db.prepare('SELECT min(p.slot) slot FROM cards b JOIN beat_placements p ON p.beat_id=b.id WHERE b.parent_id=? AND b.id!=? AND p.slot IS NOT NULL').get(sceneId,exceptBeat) as any;
 return row?.slot??null;
}

/** A beat joining a scene adopts the scene's slot, so all beats in a scene share one column. */
export function adoptSceneSlot(beatId:string){
 const beat=db.prepare('SELECT parent_id FROM cards WHERE id=?').get(beatId) as any;
 if(!beat?.parent_id)return;
 const placement=placementOf(beatId);if(!placement||placement.slot===null)return;
 const slot=sceneSlot(beat.parent_id,beatId);
 if(slot!==null&&slot!==placement.slot)db.prepare('UPDATE beat_placements SET slot=? WHERE beat_id=?').run(slot,beatId);
}

/** Beats that must survive deletion of an ancestor: placed on a lane or bridged to a turning point. */
export function laneBeatsUnder(cardId:string):string[]{
 return (db.prepare(`WITH RECURSIVE d(id) AS (SELECT id FROM cards WHERE parent_id=? UNION ALL SELECT c.id FROM cards c JOIN d ON c.parent_id=d.id)
 SELECT c.id FROM cards c JOIN d ON d.id=c.id WHERE c.type='beat' AND (EXISTS(SELECT 1 FROM beat_placements WHERE beat_id=c.id) OR EXISTS(SELECT 1 FROM turning_point_beats WHERE beat_id=c.id))`).all(cardId) as any[]).map(r=>r.id);
}

/** A beat title from turning point text: its first line, cut to the first sentence and ~90 characters at a word boundary. */
export function firstLine(text:string){
 const line=text.split(/\r?\n/).map(l=>l.replace(/^#+\s*/,'').trim()).find(Boolean)||'Turning point';
 const sentence=line.split(/(?<=[.!?])\s+/)[0];
 if(sentence.length<=90)return sentence;
 const cut=sentence.slice(0,90),space=cut.lastIndexOf(' ');
 return (space>40?cut.slice(0,space):cut).replace(/[,;:\s]+$/,'')+'…';
}

/**
 * Beat → turning point half of the bridge. Same semantics as editTP: the turning point returns to
 * draft and, if it was approved, its elements get a review badge.
 */
export function syncBeatTurningPoint(beatId:string){
 const row=db.prepare('SELECT t.*,c.title beat_title,c.body beat_body FROM turning_point_beats b JOIN turning_points t ON t.id=b.turning_point_id JOIN cards c ON c.id=b.beat_id WHERE b.beat_id=?').get(beatId) as any;
 if(!row)return;
 const text=row.beat_body.trim()?row.beat_body:row.beat_title;
 if(!text.trim()||text===row.text)return;
 db.prepare("UPDATE turning_points SET text=?,status='draft',rev=rev+1 WHERE id=?").run(text,row.id);
 if(row.status==='approved')db.prepare("UPDATE elements SET status='needs_review',review_reason='Turning point changed',version=version+1 WHERE turning_point_id=?").run(row.id);
}
