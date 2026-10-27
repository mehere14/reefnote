import db from '../db';
import {ulid} from 'ulid';
/** All offsets are UTF-16 code units, matching the editor and String.slice. */
export function rebuildMentions(id:string){
 const p=db.prepare('SELECT * FROM scene_prose WHERE scene_id=?').get(id) as any;
 const scene=db.prepare('SELECT novel_id FROM cards WHERE id=?').get(id) as any;if(!p||!scene)return;
 db.transaction(()=>{
 db.prepare('DELETE FROM mentions WHERE element_id=?').run(id);
 const cards=db.prepare("SELECT * FROM cards WHERE novel_id=? AND type IN ('character','group','setting','object','secret')").all(scene.novel_id) as any[];
 const hits:Array<{card:any,start:number,end:number}>=[];
 for(const c of cards)for(const name of [c.title,...JSON.parse(c.aliases)].filter(Boolean)){
 const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const re=new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,'giu');
 for(const match of p.text.matchAll(re))hits.push({card:c,start:match.index!,end:match.index!+match[0].length});
 }
 hits.sort((a,b)=>(b.end-b.start)-(a.end-a.start));const accepted:typeof hits=[];
 for(const h of hits){if(accepted.some(a=>h.start<a.end&&h.end>a.start))continue;accepted.push(h);
 const following=p.text.slice(h.end,h.end+100);const kind=h.card.type==='character'&&/^\s+(?:said|asked|whispered|shouted|replied|answered|muttered|told)\b/i.test(following)?'dialogue':h.card.type==='character'&&/^\s+(?:smiled|watched|walked|ran|kept|noticed|looked|frowned|turned|held|took|stepped|opened|closed|nodded|lied|blamed|hid|saw|felt|thought)\b/i.test(following)?'action':'reference';
 db.prepare('INSERT INTO mentions(id,element_id,card_id,start_offset,end_offset,card_version,prose_rev,kind) VALUES(?,?,?,?,?,?,?,?)').run(ulid(),id,h.card.id,h.start,h.end,h.card.rev,p.rev,kind);}
 db.prepare('UPDATE elements SET mention_rev=? WHERE scene_id=?').run(p.rev,id);
 })();
}
export function proseChanged(id:string){
 db.prepare("UPDATE extractions SET status='stale' WHERE element_id=? AND status='pending'").run(id);
 db.prepare("UPDATE elements SET prose_state='edited',version=version+1,summary='',review_reason=CASE WHEN prose_state='approved' THEN 'Approved prose was edited' ELSE review_reason END,status=CASE WHEN prose_state='approved' THEN 'needs_review' ELSE status END WHERE scene_id=?").run(id);
 rebuildMentions(id);
}
export function elementSnapshot(id:string){const element=db.prepare('SELECT * FROM elements WHERE scene_id=?').get(id);return element?{element,cards:db.prepare('SELECT * FROM element_cards WHERE element_id=?').all(id)}:undefined;}
export function restoreElementSnapshot(id:string,state:any){if(!state?.element)return;const old=db.prepare('SELECT version FROM elements WHERE scene_id=?').get(id) as any;const e=state.element;const subplot=e.subplot_id&&db.prepare('SELECT id FROM subplots WHERE id=?').get(e.subplot_id)?e.subplot_id:null;const tp=e.turning_point_id&&db.prepare('SELECT id FROM turning_points WHERE id=? AND subplot_id=?').get(e.turning_point_id,subplot)?e.turning_point_id:null;db.prepare('INSERT OR IGNORE INTO elements(scene_id) VALUES(?)').run(id);db.prepare("UPDATE elements SET subplot_id=?,turning_point_id=?,position=?,purpose=?,target_length=?,time_marker=?,summary=?,status='needs_review',prose_state=?,version=?,review_reason='Restored from history' WHERE scene_id=?").run(subplot,tp,e.position,e.purpose,e.target_length,e.time_marker,e.summary,e.prose_state,(old?.version||0)+1,id);db.prepare('DELETE FROM element_cards WHERE element_id=?').run(id);for(const link of state.cards||[]){if(db.prepare('SELECT id FROM cards WHERE id=?').get(link.card_id))db.prepare('INSERT INTO element_cards(element_id,card_id,role,secret_action) VALUES(?,?,?,?)').run(id,link.card_id,link.role,link.secret_action);}rebuildMentions(id);}
