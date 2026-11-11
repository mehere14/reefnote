import type Database from 'better-sqlite3';
/**
 * Lane grid tables (docs/lane-view-plan.md §3). Idempotent; runs on every boot.
 * Lanes point at existing cards; beat placement and turning point bridges are side tables,
 * so cards, links and subplots stay the single source of story content.
 */
export function migrateLanes(db:Database.Database){db.transaction(()=>{db.exec(`
CREATE TABLE IF NOT EXISTS lanes(
 id TEXT PRIMARY KEY,
 novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
 card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
 position REAL NOT NULL,
 color TEXT NOT NULL DEFAULT '',
 collapsed INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 UNIQUE(novel_id,card_id));
CREATE TABLE IF NOT EXISTS beat_placements(
 beat_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
 lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
 slot REAL,
 time_label TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS beat_placements_lane ON beat_placements(lane_id,slot);
CREATE TABLE IF NOT EXISTS turning_point_beats(
 turning_point_id TEXT PRIMARY KEY REFERENCES turning_points(id) ON DELETE CASCADE,
 beat_id TEXT NOT NULL UNIQUE REFERENCES cards(id) ON DELETE CASCADE);
`);})();}
