import db from '../db';
import {ulid} from 'ulid';
export function activeChat(novel:string,scope:string):any {
 return db.prepare('SELECT * FROM chats WHERE novel_id=? AND scope=? AND archived_at IS NULL').get(novel,scope);
}
export function newChat(novel:string,scope:string):any {
 return db.transaction(()=>{
  const card=db.prepare('SELECT type,title FROM cards WHERE novel_id=? AND id=?').get(novel,scope) as any;
  const subplot=db.prepare('SELECT title FROM subplots WHERE novel_id=? AND id=?').get(novel,scope) as any;
  const first=!db.prepare('SELECT id FROM chats WHERE novel_id=? AND scope=?').get(novel,scope);
  const now=Date.now(),id=ulid();
  db.prepare('UPDATE chats SET archived_at=? WHERE novel_id=? AND scope=? AND archived_at IS NULL').run(now,novel,scope);
  db.prepare('INSERT INTO chats(id,novel_id,scope,card_type,card_name,created_at) VALUES(?,?,?,?,?,?)').run(id,novel,scope,card?.type||(subplot?'plot':'section'),card?.title||subplot?.title||scope,now);
  if(first){
   db.prepare('UPDATE messages SET chat_id=? WHERE novel_id=? AND scope=? AND chat_id IS NULL').run(id,novel,scope);
   db.prepare('UPDATE turns SET chat_id=? WHERE novel_id=? AND scope=? AND chat_id IS NULL').run(id,novel,scope);
   db.prepare('UPDATE chats SET created_at=min(created_at,coalesce((SELECT min(created_at) FROM messages WHERE chat_id=?),created_at)) WHERE id=?').run(id,id);
  }
  return activeChat(novel,scope);
 })();
}
