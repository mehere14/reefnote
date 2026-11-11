import db from '../db';
import {createCard,snapshotCard,touchCard,getCard} from '../core';
import {firstLine} from './sync';
/**
 * Turning point ↔ beat card bridge (docs/lane-view-plan.md §3). The bridge beat is created on first
 * placement; afterwards turning point text and beat body stay equal in both directions.
 */

export function bridgeBeatOf(turningPointId:string):string|null{
 return (db.prepare('SELECT beat_id FROM turning_point_beats WHERE turning_point_id=?').get(turningPointId) as any)?.beat_id||null;
}

export function ensureBridgeBeat(turningPointId:string):string{
 const existing=bridgeBeatOf(turningPointId);if(existing)return existing;
 const tp=db.prepare('SELECT t.*,s.novel_id FROM turning_points t JOIN subplots s ON s.id=t.subplot_id WHERE t.id=?').get(turningPointId) as any;
 const beat=createCard(tp.novel_id,{type:'beat',title:firstLine(tp.text),body:tp.text},{note:'Created from turning point'});
 db.prepare('INSERT INTO turning_point_beats(turning_point_id,beat_id) VALUES(?,?)').run(turningPointId,beat.id);
 return beat.id;
}

/** Turning point → beat half of the bridge. Called after editTP changes the text. */
export function syncTurningPointBeat(turningPointId:string){
 const beatId=bridgeBeatOf(turningPointId);if(!beatId)return;
 const tp=db.prepare('SELECT text FROM turning_points WHERE id=?').get(turningPointId) as any,beat=getCard(beatId);
 const title=firstLine(tp.text);
 if(beat.body===tp.text&&beat.title===title)return;
 snapshotCard(beatId,'Turning point edited');
 db.prepare('UPDATE cards SET title=?,body=? WHERE id=?').run(title,tp.text,beatId);
 touchCard(beatId);
}
