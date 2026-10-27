import type Database from 'better-sqlite3';
import {ulid} from 'ulid';
/** Keep old card IDs/history/links, while presenting one authoritative plot. */
export function migratePlots(db:Database.Database,novelId?:string){db.transaction(()=>{
 db.exec(`CREATE TABLE IF NOT EXISTS plot_sources(card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,plot_id TEXT NOT NULL REFERENCES subplots(id) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS plot_aliases(alias_id TEXT PRIMARY KEY REFERENCES subplots(id) ON DELETE CASCADE,plot_id TEXT NOT NULL REFERENCES subplots(id) ON DELETE CASCADE);`);
 const sources=db.prepare("SELECT * FROM cards WHERE type='plot' AND NOT EXISTS(SELECT 1 FROM plot_sources WHERE card_id=cards.id)"+(novelId?' AND novel_id=?':'')+' ORDER BY created_at,id').all(...(novelId?[novelId]:[])) as any[];
 for(const card of sources){
  const candidates=db.prepare(`SELECT p.*,(SELECT count(*) FROM elements WHERE subplot_id=p.id)+(SELECT count(*) FROM turning_points WHERE subplot_id=p.id) children FROM subplots p WHERE p.novel_id=? AND lower(trim(p.title))=lower(trim(?)) AND p.premise=? AND NOT EXISTS(SELECT 1 FROM plot_aliases WHERE alias_id=p.id) AND NOT EXISTS(SELECT 1 FROM plot_sources WHERE plot_id=p.id) ORDER BY children DESC,CASE WHEN status='approved' THEN 0 ELSE 1 END,created_at,id`).all(card.novel_id,card.title,card.body) as any[];
  const canonical=candidates[0];const id=canonical?.id||ulid();
  if(!canonical)db.prepare('INSERT INTO subplots(id,novel_id,title,premise,created_at) VALUES(?,?,?,?,?)').run(id,card.novel_id,card.title,card.body,card.created_at);
  db.prepare('INSERT INTO plot_sources(card_id,plot_id) VALUES(?,?)').run(card.id,id);
  const scopes=[card.id];
  for(const duplicate of candidates.slice(1)){
   // Hide only empty, identical copies. Keep every distinct or developed plot visible.
   if(!duplicate.children&&duplicate.theme===canonical.theme&&duplicate.start_state===canonical.start_state&&duplicate.end_state===canonical.end_state&&(duplicate.status===canonical.status||duplicate.status==='draft')){db.prepare('INSERT OR IGNORE INTO plot_aliases(alias_id,plot_id) VALUES(?,?)').run(duplicate.id,id);scopes.push(duplicate.id);}
  }
  if(db.prepare("SELECT name FROM sqlite_master WHERE name='chats'").get())for(const scope of scopes){
   const active=db.prepare('SELECT id FROM chats WHERE novel_id=? AND scope=? AND archived_at IS NULL').get(card.novel_id,id) as any;
   if(active)db.prepare('UPDATE chats SET archived_at=? WHERE novel_id=? AND scope=? AND archived_at IS NULL').run(Date.now(),card.novel_id,scope);
   db.prepare("UPDATE chats SET scope=?,card_type='plot',card_name=? WHERE novel_id=? AND scope=?").run(id,card.title,card.novel_id,scope);
   for(const table of ['messages','turns'])db.prepare(`UPDATE ${table} SET scope=? WHERE novel_id=? AND scope=?`).run(id,card.novel_id,scope);
   db.prepare('UPDATE suggestions SET scope=? WHERE novel_id=? AND scope=?').run(id,card.novel_id,scope);
  }
 }
})();}
/** Old card APIs remain usable by links, history and existing AI suggestions. */
export function syncPlotCard(db:Database.Database,cardId:string){
 const row=db.prepare('SELECT p.* FROM cards c JOIN plot_sources src ON src.card_id=c.id JOIN subplots p ON p.id=src.plot_id WHERE c.id=?').get(cardId) as any;
 if(!row)return;const card=db.prepare('SELECT title,body FROM cards WHERE id=?').get(cardId) as any;
 if(row.premise===card.body&&row.title===card.title)return;
 const changed=row.premise!==card.body;
 db.prepare('UPDATE subplots SET title=?,premise=?,status=?,rev=rev+1 WHERE id=?').run(card.title,card.body,changed?'draft':row.status,row.id);
 if(changed&&row.status==='approved'){
 db.prepare("UPDATE turning_points SET status='needs_review',review_reason='Premise changed',rev=rev+1 WHERE subplot_id=?").run(row.id);
 db.prepare("UPDATE elements SET status='needs_review',review_reason='Premise changed',version=version+1 WHERE subplot_id=?").run(row.id);
 }
}
