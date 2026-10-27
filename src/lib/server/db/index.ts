import {migratePlots} from './plot-migration';
import { migrateSubplots } from './subplot-schema';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import schemaSql from './schema.sql?raw';
import { dirname, resolve } from 'node:path';
const path = process.env.NOVEL_STUDIO_DB || resolve('data/novel.db');
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
const db = new Database(path);
db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); db.pragma('synchronous = NORMAL');
const schema = schemaSql.replace(/CREATE TABLE /g, 'CREATE TABLE IF NOT EXISTS ').replace(/CREATE INDEX /g, 'CREATE INDEX IF NOT EXISTS ').replace(/CREATE VIRTUAL TABLE /g, 'CREATE VIRTUAL TABLE IF NOT EXISTS ');
db.exec(schema);
db.exec(`CREATE TRIGGER IF NOT EXISTS cards_fts_delete AFTER DELETE ON cards BEGIN DELETE FROM fts WHERE card_id=OLD.id; END;`);
if (!(db.prepare('PRAGMA table_info(turns)').all() as Array<{name:string}>).some(x=>x.name==='include_card_context')) db.exec('ALTER TABLE turns ADD COLUMN include_card_context INTEGER NOT NULL DEFAULT 1');
if (!(db.prepare('PRAGMA table_info(turns)').all() as Array<{name:string}>).some(x=>x.name==='only_current_card')) db.exec('ALTER TABLE turns ADD COLUMN only_current_card INTEGER NOT NULL DEFAULT 0');
// Idempotent style migration and the same invariant for newly created novels.
export function migrateStyles(){db.transaction(()=>{
 db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS one_book_style_per_novel ON cards(novel_id) WHERE type='style' AND subtype='book';
 INSERT INTO cards(id,novel_id,type,subtype,title,body,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),n.id,'style','book','Book voice','## POV & tense

## Prose texture

## Tone & comps

## Do

## Don''t

## Sample passages
',n.created_at,n.updated_at FROM novels n WHERE NOT EXISTS(SELECT 1 FROM cards c WHERE c.novel_id=n.id AND c.type='style' AND c.subtype='book');
 CREATE TRIGGER IF NOT EXISTS novel_book_style AFTER INSERT ON novels BEGIN
 INSERT INTO cards(id,novel_id,type,subtype,title,body,created_at,updated_at) VALUES(lower(hex(randomblob(16))),NEW.id,'style','book','Book voice','## POV & tense

## Prose texture

## Tone & comps

## Do

## Don''t

## Sample passages
',NEW.created_at,NEW.updated_at); END;`);
 // Keep the oldest valid POV and leave a review flag when legacy links conflict.
 db.exec(`INSERT INTO suggestions(id,novel_id,origin,scope,target_card_id,action,payload,what,why,fingerprint,created_at)
 SELECT lower(hex(randomblob(16))),c.novel_id,'rule',c.id,c.id,'flag_issue','{}','Review point-of-view character','Multiple legacy POV links were found. The earliest valid character link was retained.','style-migration-pov:'||c.id,c.updated_at
 FROM cards c WHERE (SELECT count(*) FROM links WHERE from_id=c.id AND label='POV')>1 AND NOT EXISTS(SELECT 1 FROM suggestions WHERE fingerprint='style-migration-pov:'||c.id);
 DELETE FROM links WHERE label='POV' AND (NOT EXISTS(SELECT 1 FROM cards f JOIN cards t ON t.id=links.to_id WHERE f.id=links.from_id AND f.type='scene' AND t.type='character' AND f.novel_id=t.novel_id) OR EXISTS(SELECT 1 FROM links earlier JOIN cards t ON t.id=earlier.to_id WHERE earlier.from_id=links.from_id AND earlier.label='POV' AND t.type='character' AND (earlier.created_at<links.created_at OR (earlier.created_at=links.created_at AND earlier.id<links.id))));
 CREATE UNIQUE INDEX IF NOT EXISTS one_pov_per_scene ON links(from_id) WHERE label='POV';
 CREATE UNIQUE INDEX IF NOT EXISTS one_style_per_card ON links(from_id) WHERE label='uses_style';
 CREATE TRIGGER IF NOT EXISTS validate_style_link BEFORE INSERT ON links WHEN NEW.label IN ('POV','uses_style') BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cards f JOIN cards t ON t.id=NEW.to_id WHERE f.id=NEW.from_id AND f.novel_id=t.novel_id AND f.novel_id=NEW.novel_id AND ((NEW.label='POV' AND f.type='scene' AND t.type='character') OR (NEW.label='uses_style' AND f.type IN ('chapter','scene') AND t.type='style' AND t.subtype='preset'))) THEN RAISE(ABORT,'Invalid style or POV link') END; END;
 `);
 for(const [name,definition] of [['style_context',"TEXT NOT NULL DEFAULT '[]'"],['style_exclusions',"TEXT NOT NULL DEFAULT '[]'"]])if(!(db.prepare('PRAGMA table_info(turns)').all() as Array<{name:string}>).some(x=>x.name===name))db.exec(`ALTER TABLE turns ADD COLUMN ${name} ${definition}`);
})();}
migrateStyles();
// Chats retain card metadata without a card foreign key, including after deletion.
db.exec(`CREATE TABLE IF NOT EXISTS chats (
 id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
 scope TEXT NOT NULL, card_type TEXT NOT NULL, card_name TEXT NOT NULL,
 created_at INTEGER NOT NULL, archived_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS chats_active ON chats(novel_id,scope) WHERE archived_at IS NULL;`);
for(const table of ['messages','turns'])if(!(db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>).some(x=>x.name==='chat_id'))db.exec(`ALTER TABLE ${table} ADD COLUMN chat_id TEXT`);
db.transaction(()=>{
 db.exec(`INSERT INTO chats(id,novel_id,scope,card_type,card_name,created_at,archived_at)
 SELECT lower(hex(randomblob(16))),m.novel_id,m.scope,coalesce(c.type,'section'),coalesce(c.title,m.scope),min(m.created_at),
 CASE WHEN c.id IS NULL AND length(m.scope)>20 THEN min(m.created_at) ELSE NULL END
 FROM messages m LEFT JOIN cards c ON c.id=m.scope WHERE m.chat_id IS NULL
 AND NOT EXISTS(SELECT 1 FROM chats h WHERE h.novel_id=m.novel_id AND h.scope=m.scope)
 GROUP BY m.novel_id,m.scope;
 UPDATE messages SET chat_id=(SELECT id FROM chats WHERE chats.novel_id=messages.novel_id AND chats.scope=messages.scope ORDER BY created_at LIMIT 1) WHERE chat_id IS NULL;
 UPDATE turns SET chat_id=(SELECT chat_id FROM messages WHERE turn_id=turns.id LIMIT 1) WHERE chat_id IS NULL;
 CREATE TRIGGER IF NOT EXISTS chat_message_insert AFTER INSERT ON messages WHEN NEW.chat_id IS NULL BEGIN
 UPDATE messages SET chat_id=coalesce((SELECT chat_id FROM turns WHERE id=NEW.turn_id),(SELECT id FROM chats WHERE novel_id=NEW.novel_id AND scope=NEW.scope AND archived_at IS NULL)) WHERE id=NEW.id; END;
 CREATE TRIGGER IF NOT EXISTS chat_card_delete BEFORE DELETE ON cards BEGIN
 UPDATE chats SET card_type=OLD.type,card_name=OLD.title,archived_at=coalesce(archived_at,CAST(strftime('%s','now') AS INTEGER)*1000) WHERE novel_id=OLD.novel_id AND scope=OLD.id; END;
 CREATE TRIGGER IF NOT EXISTS chat_card_rename AFTER UPDATE OF title,type ON cards BEGIN
 UPDATE chats SET card_type=NEW.type,card_name=NEW.title WHERE scope=NEW.id AND novel_id=NEW.novel_id AND archived_at IS NULL; END;`);
})();
db.exec(`CREATE TABLE IF NOT EXISTS pinned_messages (
 novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
 message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL, PRIMARY KEY(novel_id,message_id)
);`);
migrateSubplots(db);
migratePlots(db);
export const dataDirectory = path === ':memory:' ? resolve(process.env.DATA_DIR || 'data') : dirname(resolve(path));
export default db;
export { db };
