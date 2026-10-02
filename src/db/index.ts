import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { config } from '../config.js'
import { logger } from '../logger.js'

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true })

export const db = new Database(config.dbPath)

db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS chats (
    jid             TEXT PRIMARY KEY,
    name            TEXT,
    is_group        INTEGER NOT NULL DEFAULT 0,
    tracked         INTEGER NOT NULL DEFAULT 0,
    last_message_at INTEGER,
    message_count   INTEGER NOT NULL DEFAULT 0,
    last_digest_at  INTEGER,
    created_at      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,
    chat_jid    TEXT NOT NULL,
    sender_jid  TEXT,
    sender_name TEXT,
    ts          INTEGER NOT NULL,
    from_me     INTEGER NOT NULL DEFAULT 0,
    kind        TEXT NOT NULL DEFAULT 'text',
    text        TEXT,
    quoted_text TEXT,
    mentions_me INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages (chat_jid, ts);
  CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages (ts);

  CREATE TABLE IF NOT EXISTS digests (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_jid       TEXT NOT NULL,
    chat_name      TEXT,
    period_start   INTEGER NOT NULL,
    period_end     INTEGER NOT NULL,
    message_count  INTEGER NOT NULL,
    model          TEXT NOT NULL,
    summary_md     TEXT NOT NULL,
    tokens_in      INTEGER NOT NULL DEFAULT 0,
    tokens_out     INTEGER NOT NULL DEFAULT 0,
    trigger        TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    delivered_at   INTEGER,
    delivery_error TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_digests_created ON digests (created_at DESC);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

ensureColumn('chats', 'extra_prompt', 'TEXT')
ensureColumn('messages', 'media_json', 'TEXT')

logger.debug({ dbPath: config.dbPath }, 'база готова')
