import db from '../db';
import {ulid} from 'ulid';
import {getCard,saveProse,snapshotCard} from '../core';
import {ensureElement,getElement,fail} from './service';
import type {PassageReplacement} from '../../subplot-types';
export function getSet(id:string):any{return db.prepare('SELECT * FROM change_sets WHERE id=?').get(id)||fail('Change set not found',404);}
export function setDetail(id:string){return {...getSet(id),hunks:db.prepare('SELECT h.*,c.title,e.position,e.subplot_id FROM change_hunks h JOIN cards c ON c.id=h.element_id LEFT JOIN elements e ON e.scene_id=h.element_id WHERE change_set_id=? ORDER BY e.position,h.element_id,h.start_offset,h.id').all(id)};}
export function reserveSet(novelId:string,title:string,cause:string,ref:string,ids:string[]){return db.transaction(()=>{for(const id of ids){const e=ensureElement(id);if(e.novel_id!==novelId)fail('Element belongs to another novel');if(db.prepare("SELECT h.id FROM change_hunks h JOIN change_sets s ON s.id=h.change_set_id WHERE h.element_id=? AND (h.status='pending' OR s.run_status='running') AND s.status IN ('proposed','partially_accepted')").get(id))fail('Resolve the existing change set on this element first',409);}
 const id=ulid();db.prepare('INSERT INTO change_sets(id,novel_id,title,cause_type,cause_ref,run_status,created_at) VALUES(?,?,?,?,?,?,?)').run(id,novelId,title,cause,ref,'running',Date.now());
 // Reservation hunks also protect elements whose requests have not started yet.
 for(const eid of ids){const e=getElement(eid);db.prepare("INSERT INTO change_hunks(id,change_set_id,element_id,field,before,after,ai_note,base_prose_rev) VALUES(?,?,?,'summary',?,?,'Generation reservation',?)").run(ulid(),id,eid,e.summary,e.summary,e.prose.rev);}return id;})();}
export function addReplacements(setId:string,elementId:string,replacements:PassageReplacement[],baseText:string,baseRev:number){db.transaction(()=>{
 const e=getElement(elementId);if(e.prose.rev!==baseRev||e.prose.text!==baseText)fail('Element changed during generation; retry after resolving this set',409);
 const sorted=[...replacements].sort((a,b)=>a.start-b.start);let end=-1;
 for(const r of sorted){if(!Number.isInteger(r.start)||!Number.isInteger(r.end)||r.start<0||r.start<end||r.end<r.start||r.end>baseText.length||baseText.slice(r.start,r.end)!==r.before||!r.before.length)fail('AI returned invalid or overlapping passage offsets');end=r.end;
 const paraStart=baseText.lastIndexOf('\n\n',Math.max(0,r.start-1))+2;const next=baseText.indexOf('\n\n',r.end);const paraEnd=next<0?baseText.length:next;
 if(r.start!==0&&paraStart!==r.start||r.end!==baseText.length&&paraEnd!==r.end)fail('AI replacements must cover complete paragraphs');
 const mentions=db.prepare('SELECT * FROM mentions WHERE element_id=?').all(elementId) as any[];
 const cause=getSet(setId);const affected=mentions.filter(m=>m.card_id===cause.cause_ref);if(cause.cause_type==='card_edit'&&!affected.some(m=>m.start_offset<r.end&&m.end_offset>r.start)&&!r.ai_note.trim())fail('A passage outside mentions requires an explanation');
 const beforeStart=baseText.lastIndexOf('\n\n',Math.max(0,r.start-3));const afterEnd=baseText.indexOf('\n\n',r.end+2);
 db.prepare("INSERT INTO change_hunks(id,change_set_id,element_id,field,before,after,start_offset,context_before,context_after,ai_note,warning,base_prose_rev) VALUES(?,?,?,'prose',?,?,?,?,?,?,?,?)").run(ulid(),setId,elementId,r.before,r.after,r.start,baseText.slice(Math.max(0,beforeStart+2),r.start),baseText.slice(r.end,afterEnd<0?baseText.length:afterEnd),r.ai_note,r.warning||'',baseRev);
 }
 db.prepare("DELETE FROM change_hunks WHERE change_set_id=? AND element_id=? AND ai_note='Generation reservation'").run(setId,elementId);
 })();}
export function addSummaryHunk(setId:string,elementId:string,after:string){const e=getElement(elementId);db.prepare("INSERT INTO change_hunks(id,change_set_id,element_id,field,before,after,base_prose_rev) VALUES(?,?,?,'summary',?,?,?)").run(ulid(),setId,elementId,e.summary,after,e.prose.rev);}
function refreshStatus(id:string){const counts=db.prepare("SELECT status,count(*) n FROM change_hunks WHERE change_set_id=? GROUP BY status").all(id) as any[];const n=(s:string)=>counts.find(c=>c.status===s)?.n||0;const status=n('accepted')?(n('pending')||n('rejected')?'partially_accepted':'accepted'):n('pending')?'proposed':'rejected';db.prepare('UPDATE change_sets SET status=? WHERE id=?').run(status,id);}
function locate(text:string,before:string,offset:number,allowOffset=false){if(allowOffset&&text.slice(offset,offset+before.length)===before)return offset;const i=text.indexOf(before);if(i<0||text.indexOf(before,i+1)>=0)fail('Passage changed or is ambiguous; no changes were applied',409);return i;}
export function resolveHunks(id:string,input:{action:'accept'|'reject';hunkIds?:string[];elementId?:string}){return db.transaction(()=>{const set=getSet(id);if(set.run_status==='running')fail('Stop generation or wait for it to finish',409);if(set.status==='rolled_back')fail('This set was rolled back',409);const all=db.prepare("SELECT * FROM change_hunks WHERE change_set_id=? AND status='pending'").all(id) as any[];const chosen=all.filter(h=>(!input.hunkIds||input.hunkIds.includes(h.id))&&(!input.elementId||h.element_id===input.elementId));if(!chosen.length)fail('No pending hunks selected');const ids=[...new Set(chosen.map(h=>h.element_id))];
 for(const eid of ids){const e=getElement(eid),hs=chosen.filter(h=>h.element_id===eid);if(input.action==='accept'){
 if(hs.every(h=>h.field!=='prose'))snapshotCard(eid,`Accepted ${set.title}`,'suggestion');
 if(hs.some(h=>h.field==='spec'))fail('Review spec proposals through the element spec editor');
 let text=e.prose.text;const prose=hs.filter(h=>h.field==='prose').map(h=>({...h,at:locate(text,h.before,h.start_offset,h.base_prose_rev===e.prose.rev)})).sort((a,b)=>b.at-a.at);for(let i=1;i<prose.length;i++)if(prose[i].at+prose[i].before.length>prose[i-1].at)fail('Overlapping hunks',409);
 for(const h of prose){text=text.slice(0,h.at)+h.after+text.slice(h.at+h.before.length);db.prepare('UPDATE change_hunks SET applied_start=? WHERE id=?').run(h.at,h.id);}
 const summary=hs.find(h=>h.field==='summary');if(summary&&e.summary!==summary.before)fail('Summary changed; reload the review',409);
 if(prose.length)db.prepare('INSERT INTO change_applications(id,change_set_id,element_id,before_text,after_text,before_summary,created_at) VALUES(?,?,?,?,?,?,?)').run(ulid(),id,eid,e.prose.text,text,e.summary,Date.now());
 if(prose.length)saveProse(eid,{text,baseRev:e.prose.rev},{note:`Accepted ${set.title}`,source:'suggestion'});
 // Summary previews apply only when they describe the complete accepted prose outcome.
 const remainingProse=all.filter(h=>h.element_id===eid&&h.field==='prose'&&!chosen.some(c=>c.id===h.id));const rejected=db.prepare("SELECT id FROM change_hunks WHERE change_set_id=? AND element_id=? AND field='prose' AND status='rejected'").get(id,eid);
 if(summary&&(!prose.length||(!remainingProse.length&&!rejected)))db.prepare('UPDATE elements SET summary=? WHERE scene_id=?').run(summary.after,eid);
 db.prepare("UPDATE elements SET version=?,prose_state=CASE WHEN ? THEN 'edited' ELSE prose_state END WHERE scene_id=?").run(e.version+1,prose.length?1:0,eid);
 }
 for(const h of hs)db.prepare('UPDATE change_hunks SET status=? WHERE id=?').run(input.action==='accept'?'accepted':'rejected',h.id);
 }
 refreshStatus(id);return {change_set:setDetail(id),touched:input.action==='accept'?ids:[],prose_touched:input.action==='accept'?ids.filter(eid=>chosen.some(h=>h.element_id===eid&&h.field==='prose')):[],preview_elements:ids};})();}
export function rollback(id:string){return db.transaction(()=>{const s=getSet(id);if(s.run_status==='running'||s.status==='rolled_back')fail('Cannot roll back this set',409);const hs=db.prepare("SELECT * FROM change_hunks WHERE change_set_id=? AND status='accepted'").all(id) as any[];if(!hs.length)fail('No accepted changes to roll back');const ids=[...new Set(hs.map(h=>h.element_id))];const restores:Array<{id:string;text:string;summary?:string;e:any}>=[];
 for(const eid of ids){const e=getElement(eid);let text=e.prose.text;const proseHunks=hs.filter(h=>h.element_id===eid&&h.field==='prose');const apps=db.prepare('SELECT * FROM change_applications WHERE change_set_id=? AND element_id=? ORDER BY created_at DESC,id DESC').all(id,eid) as any[];
 if(proseHunks.some(h=>!h.after.length)){for(const app of apps){if(text!==app.after_text)fail('A deleted passage has conflicting later edits; rollback stopped',409);text=app.before_text;}}else{const prose=proseHunks.map(h=>({...h,at:locate(text,h.after,h.applied_start??h.start_offset,apps[0]?.after_text===text)})).sort((a,b)=>b.at-a.at);for(let i=1;i<prose.length;i++)if(prose[i].at+prose[i].after.length>prose[i-1].at)fail('Rollback passages overlap',409);for(const h of prose)text=text.slice(0,h.at)+h.before+text.slice(h.at+h.after.length);}
 const sum=hs.find(h=>h.element_id===eid&&h.field==='summary');if(sum&&!proseHunks.length&&e.summary!==sum.after)fail('Summary has changed; rollback stopped',409);restores.push({id:eid,text,summary:apps.at(-1)?.before_summary??sum?.before,e});}
 for(const r of restores){if(r.text!==r.e.prose.text)saveProse(r.id,{text:r.text,baseRev:r.e.prose.rev},{note:`Rolled back ${s.title}`,source:'restore'});else snapshotCard(r.id,`Rolled back ${s.title}`,'restore');db.prepare('UPDATE elements SET summary=?,version=? WHERE scene_id=?').run(r.summary??'',r.e.version+1,r.id);}
 db.prepare("UPDATE change_sets SET status='rolled_back' WHERE id=?").run(id);db.prepare("UPDATE change_hunks SET status='rejected' WHERE change_set_id=? AND status='pending'").run(id);return {change_set:setDetail(id),touched:ids};})();}
