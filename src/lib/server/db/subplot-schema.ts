import type Database from 'better-sqlite3';
export function migrateSubplots(db:Database.Database){db.transaction(()=>{db.exec(`
CREATE TABLE IF NOT EXISTS subplots(id TEXT PRIMARY KEY,novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,title TEXT NOT NULL,premise TEXT NOT NULL DEFAULT '',theme TEXT NOT NULL DEFAULT '',start_state TEXT NOT NULL DEFAULT '',end_state TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'draft',rev INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS plot_versions(id TEXT PRIMARY KEY,novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,target_kind TEXT NOT NULL,target_id TEXT NOT NULL,snapshot TEXT NOT NULL,note TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'user',created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS plot_versions_target ON plot_versions(target_kind,target_id,created_at);
CREATE TABLE IF NOT EXISTS turning_points(id TEXT PRIMARY KEY,subplot_id TEXT NOT NULL REFERENCES subplots(id) ON DELETE CASCADE,position REAL NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',rev INTEGER NOT NULL DEFAULT 1,review_reason TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS elements(scene_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,subplot_id TEXT REFERENCES subplots(id) ON DELETE SET NULL,turning_point_id TEXT REFERENCES turning_points(id) ON DELETE SET NULL,position REAL NOT NULL DEFAULT 0,purpose TEXT NOT NULL DEFAULT '',target_length INTEGER NOT NULL DEFAULT 1200,time_marker TEXT NOT NULL DEFAULT '',summary TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'draft',prose_state TEXT NOT NULL DEFAULT 'empty',version INTEGER NOT NULL DEFAULT 1,review_reason TEXT NOT NULL DEFAULT '',mention_rev INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS elements_subplot ON elements(subplot_id,position);
CREATE TABLE IF NOT EXISTS element_cards(element_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('on_stage','referenced')),secret_action TEXT CHECK(secret_action IN ('introduced','hinted','revealed')),PRIMARY KEY(element_id,card_id));
CREATE TABLE IF NOT EXISTS plot_cards(plot_id TEXT NOT NULL REFERENCES subplots(id) ON DELETE CASCADE,card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,PRIMARY KEY(plot_id,card_id));
CREATE TABLE IF NOT EXISTS turning_point_cards(turning_point_id TEXT NOT NULL REFERENCES turning_points(id) ON DELETE CASCADE,card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,PRIMARY KEY(turning_point_id,card_id));
CREATE TABLE IF NOT EXISTS mentions(id TEXT PRIMARY KEY,element_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,start_offset INTEGER NOT NULL,end_offset INTEGER NOT NULL,card_version INTEGER NOT NULL,prose_rev INTEGER NOT NULL,kind TEXT NOT NULL DEFAULT 'reference');
CREATE INDEX IF NOT EXISTS mentions_card ON mentions(card_id,element_id);
CREATE TABLE IF NOT EXISTS element_links(element_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,linked_element_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,type TEXT NOT NULL CHECK(type IN ('depends_on','shares_scene_with')),PRIMARY KEY(element_id,linked_element_id,type));
CREATE TABLE IF NOT EXISTS change_sets(id TEXT PRIMARY KEY,novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,title TEXT NOT NULL,cause_type TEXT NOT NULL,cause_ref TEXT,status TEXT NOT NULL DEFAULT 'proposed',run_status TEXT NOT NULL DEFAULT 'done',error TEXT,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS change_hunks(id TEXT PRIMARY KEY,change_set_id TEXT NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE,element_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,field TEXT NOT NULL CHECK(field IN ('prose','summary','spec')),before TEXT NOT NULL,after TEXT NOT NULL,start_offset INTEGER NOT NULL DEFAULT 0,context_before TEXT NOT NULL DEFAULT '',context_after TEXT NOT NULL DEFAULT '',ai_note TEXT NOT NULL DEFAULT '',warning TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',base_prose_rev INTEGER NOT NULL,applied_start INTEGER);
CREATE TABLE IF NOT EXISTS subplot_jobs(change_set_id TEXT PRIMARY KEY REFERENCES change_sets(id) ON DELETE CASCADE,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS change_applications(id TEXT PRIMARY KEY,change_set_id TEXT NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE,element_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,before_text TEXT NOT NULL,after_text TEXT NOT NULL,before_summary TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS subplot_requests(id TEXT PRIMARY KEY,novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,target_id TEXT NOT NULL,kind TEXT NOT NULL,context TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'running',result TEXT,error TEXT,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS extractions(id TEXT PRIMARY KEY,element_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,prose_rev INTEGER NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending');
CREATE TABLE IF NOT EXISTS subplot_proposals(id TEXT PRIMARY KEY,novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,target_id TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',base_rev INTEGER NOT NULL);
`);
// Capture content changes at the database boundary, including AI and legacy-card edits.
db.exec(`
CREATE TRIGGER IF NOT EXISTS subplots_version_before_update BEFORE UPDATE ON subplots WHEN OLD.title IS NOT NEW.title OR OLD.premise IS NOT NEW.premise OR OLD.theme IS NOT NEW.theme OR OLD.start_state IS NOT NEW.start_state OR OLD.end_state IS NOT NEW.end_state BEGIN
 INSERT INTO plot_versions(id,novel_id,target_kind,target_id,snapshot,note,created_at) VALUES(lower(hex(randomblob(16))),OLD.novel_id,'subplots',OLD.id,json_object('title',OLD.title,'premise',OLD.premise,'theme',OLD.theme,'start_state',OLD.start_state,'end_state',OLD.end_state),'Edited plot',CAST((julianday('now')-2440587.5)*86400000 AS INTEGER));
END;
CREATE TRIGGER IF NOT EXISTS subplots_version_created AFTER INSERT ON subplots BEGIN
 INSERT INTO plot_versions(id,novel_id,target_kind,target_id,snapshot,note,created_at) VALUES(lower(hex(randomblob(16))),NEW.novel_id,'subplots',NEW.id,json_object('title',NEW.title,'premise',NEW.premise,'theme',NEW.theme,'start_state',NEW.start_state,'end_state',NEW.end_state),'Created',CAST((julianday('now')-2440587.5)*86400000 AS INTEGER));
END;
INSERT INTO plot_versions(id,novel_id,target_kind,target_id,snapshot,note,created_at)
 SELECT lower(hex(randomblob(16))),OLD.novel_id,'subplots',OLD.id,json_object('title',OLD.title,'premise',OLD.premise,'theme',OLD.theme,'start_state',OLD.start_state,'end_state',OLD.end_state),'History enabled',CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) FROM subplots OLD WHERE NOT EXISTS(SELECT 1 FROM plot_versions v WHERE v.target_kind='subplots' AND v.target_id=OLD.id);
CREATE TRIGGER IF NOT EXISTS turning_points_version_before_update BEFORE UPDATE ON turning_points WHEN OLD.text IS NOT NEW.text BEGIN
 INSERT INTO plot_versions(id,novel_id,target_kind,target_id,snapshot,note,created_at) VALUES(lower(hex(randomblob(16))),(SELECT novel_id FROM subplots WHERE id=OLD.subplot_id),'turning-points',OLD.id,json_object('text',OLD.text),'Edited turning point',CAST((julianday('now')-2440587.5)*86400000 AS INTEGER));
END;
CREATE TRIGGER IF NOT EXISTS turning_points_version_created AFTER INSERT ON turning_points BEGIN
 INSERT INTO plot_versions(id,novel_id,target_kind,target_id,snapshot,note,created_at) VALUES(lower(hex(randomblob(16))),(SELECT novel_id FROM subplots WHERE id=NEW.subplot_id),'turning-points',NEW.id,json_object('text',NEW.text),'Created',CAST((julianday('now')-2440587.5)*86400000 AS INTEGER));
END;
INSERT INTO plot_versions(id,novel_id,target_kind,target_id,snapshot,note,created_at)
 SELECT lower(hex(randomblob(16))),(SELECT novel_id FROM subplots WHERE id=OLD.subplot_id),'turning-points',OLD.id,json_object('text',OLD.text),'History enabled',CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) FROM turning_points OLD WHERE NOT EXISTS(SELECT 1 FROM plot_versions v WHERE v.target_kind='turning-points' AND v.target_id=OLD.id);
`);
db.prepare("UPDATE subplot_requests SET status='interrupted',error='Server restarted; retry explicitly.' WHERE status='running'").run();
db.prepare("UPDATE change_sets SET run_status='interrupted',error='Server restarted; completed hunks were preserved.' WHERE run_status='running'").run();db.prepare("DELETE FROM change_hunks WHERE ai_note='Generation reservation' AND change_set_id IN (SELECT id FROM change_sets WHERE run_status='interrupted')").run();
})();}
