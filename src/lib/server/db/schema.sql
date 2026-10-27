
CREATE TABLE novels (
  id            TEXT PRIMARY KEY,            -- ulid
  title         TEXT NOT NULL,
  tagline       TEXT NOT NULL DEFAULT 'a novel in progress',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_opened_at INTEGER
);

CREATE TABLE cards (
  id          TEXT PRIMARY KEY,               -- ulid
  novel_id    TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                  -- see §2.3
  subtype     TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL,
  aliases     TEXT NOT NULL DEFAULT '[]',     -- JSON array of strings ("the Admiral", "Steve")
  body        TEXT NOT NULL DEFAULT '',
  fields      TEXT NOT NULL DEFAULT '{}',     -- JSON object of string fields (§2.4)
  parent_id   TEXT REFERENCES cards(id) ON DELETE CASCADE,
  position    REAL NOT NULL DEFAULT 0,        -- fractional ordering among siblings
  digest      TEXT NOT NULL DEFAULT '',       -- AI-written short summary for context (§7.4)
  digest_rev  INTEGER NOT NULL DEFAULT 0,     -- rev the digest was computed at
  rev         INTEGER NOT NULL DEFAULT 1,     -- increments on every change
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX cards_novel_type ON cards(novel_id, type);
CREATE INDEX cards_parent ON cards(parent_id, position);

-- Prose lives apart from cards so card lists never load it.
-- One row per scene; a scene's prose can be arbitrarily long.
CREATE TABLE scene_prose (
  scene_id    TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  text        TEXT NOT NULL DEFAULT '',
  word_count  INTEGER NOT NULL DEFAULT 0,
  rev         INTEGER NOT NULL DEFAULT 1,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE links (
  id          TEXT PRIMARY KEY,
  novel_id    TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  from_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  to_id       TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  label       TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  UNIQUE(from_id, to_id, label)
);
CREATE INDEX links_from ON links(from_id);
CREATE INDEX links_to ON links(to_id);

CREATE TABLE versions (
  id          TEXT PRIMARY KEY,
  card_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  note        TEXT NOT NULL,                  -- "Renamed", "Co-writer addition accepted", ...
  snapshot    BLOB NOT NULL,                  -- gzip(JSON {title, subtype, body, fields, aliases, prose?})
  source      TEXT NOT NULL,                  -- 'user' | 'suggestion' | 'restore'
  suggestion_id TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX versions_card ON versions(card_id, created_at DESC);

CREATE TABLE turns (
  id          TEXT PRIMARY KEY,               -- one AI request (pass 1 + pass 2)
  novel_id    TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL,                  -- section key or card id
  flow        TEXT NOT NULL,                  -- see §8.2
  status      TEXT NOT NULL,                  -- 'writing' | 'structuring' | 'done' | 'error'
  error       TEXT,
  context_manifest TEXT NOT NULL DEFAULT '[]',-- JSON list of {card_id, form, tokens} actually sent (§7.6)
  model_write TEXT, model_struct TEXT,
  tokens_in   INTEGER, tokens_out INTEGER,
  created_at  INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE messages (
  id          TEXT PRIMARY KEY,
  novel_id    TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL,
  role        TEXT NOT NULL,                  -- 'user' | 'assistant'
  text        TEXT NOT NULL,                  -- assistant: pass-1 markdown
  turn_id     TEXT REFERENCES turns(id),
  created_at  INTEGER NOT NULL
);
CREATE INDEX messages_scope ON messages(novel_id, scope, created_at);

CREATE TABLE suggestions (
  id          TEXT PRIMARY KEY,
  novel_id    TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  turn_id     TEXT REFERENCES turns(id),      -- null for rule-check flags
  origin      TEXT NOT NULL,                  -- 'ai' | 'rule'
  scope       TEXT NOT NULL,                  -- where it was raised (section key or card id)
  target_card_id TEXT REFERENCES cards(id) ON DELETE CASCADE, -- null for create_card
  base_rev    INTEGER,                        -- target card rev when suggested
  action      TEXT NOT NULL,                  -- create_card | update_card | add_link | flag_issue
  payload     TEXT NOT NULL,                  -- JSON, shape per action (§8.5)
  what        TEXT NOT NULL,
  why         TEXT NOT NULL DEFAULT '',
  preview     TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL,                  -- for rejection memory (§8.7)
  status      TEXT NOT NULL DEFAULT 'pending',-- pending | accepted | rejected | stale
  resolved_at INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX sugg_pending ON suggestions(novel_id, status);
CREATE INDEX sugg_target ON suggestions(target_card_id, status);

CREATE TABLE rejections (
  novel_id    TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  what        TEXT NOT NULL,                  -- human-readable, also fed to prompts
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (novel_id, fingerprint)
);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL                   -- JSON; secrets stored encrypted (§10.3)
);

-- Full-text search over cards and prose (used for mention detection and Ask)
CREATE VIRTUAL TABLE fts USING fts5(card_id UNINDEXED, novel_id UNINDEXED, kind UNINDEXED, text, tokenize='porter unicode61');

CREATE TABLE llm_requests (
 id TEXT PRIMARY KEY,
 provider TEXT NOT NULL,
 model TEXT NOT NULL,
 started_at INTEGER NOT NULL,
 latency_ms INTEGER NOT NULL,
 tokens_in INTEGER,
 tokens_out INTEGER,
 status TEXT NOT NULL
);
CREATE INDEX llm_requests_started ON llm_requests(started_at);
