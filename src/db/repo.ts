import { db } from './index.js'

export interface ChatRow {
  jid: string
  name: string | null
  is_group: number
  tracked: number
  last_message_at: number | null
  message_count: number
  last_digest_at: number | null
  created_at: number
}

export interface MessageRow {
  id: string
  chat_jid: string
  sender_jid: string | null
  sender_name: string | null
  ts: number
  from_me: number
  kind: string
  text: string | null
  quoted_text: string | null
  mentions_me: number
  created_at: number
}

export interface DigestRow {
  id: number
  chat_jid: string
  chat_name: string | null
  period_start: number
  period_end: number
  message_count: number
  model: string
  summary_md: string
  tokens_in: number
  tokens_out: number
  trigger: string
  created_at: number
  delivered_at: number | null
  delivery_error: string | null
}

export interface IncomingMessage {
  id: string
  chatJid: string
  chatName?: string | null
  isGroup: boolean
  senderJid?: string | null
  senderName?: string | null
  ts: number
  fromMe: boolean
  kind: string
  text: string | null
  quotedText?: string | null
  mentionsMe?: boolean
}

const now = () => Math.floor(Date.now() / 1000)

const upsertChatStmt = db.prepare(`
  INSERT INTO chats (jid, name, is_group, tracked, last_message_at, message_count, created_at)
  VALUES (@jid, @name, @is_group, 0, @last_message_at, 0, @created_at)
  ON CONFLICT(jid) DO UPDATE SET
    name = COALESCE(excluded.name, chats.name),
    is_group = excluded.is_group,
    last_message_at = MAX(COALESCE(chats.last_message_at, 0), COALESCE(excluded.last_message_at, 0))
`)

const insertMessageStmt = db.prepare(`
  INSERT INTO messages (id, chat_jid, sender_jid, sender_name, ts, from_me, kind, text, quoted_text, mentions_me, created_at)
  VALUES (@id, @chat_jid, @sender_jid, @sender_name, @ts, @from_me, @kind, @text, @quoted_text, @mentions_me, @created_at)
  ON CONFLICT(id) DO UPDATE SET
    text = COALESCE(excluded.text, messages.text),
    sender_name = COALESCE(excluded.sender_name, messages.sender_name),
    quoted_text = COALESCE(excluded.quoted_text, messages.quoted_text)
`)

const recountChatStmt = db.prepare(`
  UPDATE chats SET
    message_count = (SELECT COUNT(*) FROM messages WHERE chat_jid = ?),
    last_message_at = (SELECT MAX(ts) FROM messages WHERE chat_jid = ?)
  WHERE jid = ?
`)

export function upsertChat(input: { jid: string; name?: string | null; isGroup: boolean; lastMessageAt?: number | null }) {
  upsertChatStmt.run({
    jid: input.jid,
    name: input.name ?? null,
    is_group: input.isGroup ? 1 : 0,
    last_message_at: input.lastMessageAt ?? null,
    created_at: now(),
  })
}

/** Пишет пачку сообщений одной транзакцией и пересчитывает счётчики затронутых чатов. */
export const saveMessages = db.transaction((messages: IncomingMessage[]) => {
  const touchedChats = new Set<string>()
  let inserted = 0

  for (const message of messages) {
    upsertChat({
      jid: message.chatJid,
      name: message.chatName ?? null,
      isGroup: message.isGroup,
      lastMessageAt: message.ts,
    })

    const result = insertMessageStmt.run({
      id: message.id,
      chat_jid: message.chatJid,
      sender_jid: message.senderJid ?? null,
      sender_name: message.senderName ?? null,
      ts: message.ts,
      from_me: message.fromMe ? 1 : 0,
      kind: message.kind,
      text: message.text,
      quoted_text: message.quotedText ?? null,
      mentions_me: message.mentionsMe ? 1 : 0,
      created_at: now(),
    })

    if (result.changes > 0) inserted += 1
    touchedChats.add(message.chatJid)
  }

  for (const jid of touchedChats) {
    recountChatStmt.run(jid, jid, jid)
  }

  return inserted
})

export function renameChat(jid: string, name: string) {
  db.prepare('UPDATE chats SET name = ? WHERE jid = ?').run(name, jid)
}

export function listChats(options: { query?: string; onlyTracked?: boolean } = {}): ChatRow[] {
  const clauses: string[] = []
  const params: unknown[] = []

  if (options.onlyTracked) clauses.push('tracked = 1')
  if (options.query) {
    clauses.push('(LOWER(COALESCE(name, \'\')) LIKE ? OR LOWER(jid) LIKE ?)')
    const like = `%${options.query.toLowerCase()}%`
    params.push(like, like)
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return db
    .prepare(
      `SELECT * FROM chats ${where}
       ORDER BY tracked DESC, COALESCE(last_message_at, 0) DESC
       LIMIT 500`,
    )
    .all(...params) as ChatRow[]
}

export function getChat(jid: string): ChatRow | undefined {
  return db.prepare('SELECT * FROM chats WHERE jid = ?').get(jid) as ChatRow | undefined
}

export function setChatTracked(jid: string, tracked: boolean) {
  db.prepare('UPDATE chats SET tracked = ? WHERE jid = ?').run(tracked ? 1 : 0, jid)
}

export function markChatDigested(jid: string, at: number) {
  db.prepare('UPDATE chats SET last_digest_at = ? WHERE jid = ?').run(at, jid)
}

export function getMessagesInWindow(chatJid: string, from: number, to: number): MessageRow[] {
  return db
    .prepare('SELECT * FROM messages WHERE chat_jid = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC')
    .all(chatJid, from, to) as MessageRow[]
}

export function countMessagesInWindow(chatJid: string, from: number, to: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM messages WHERE chat_jid = ? AND ts >= ? AND ts <= ?')
    .get(chatJid, from, to) as { count: number }
  return row.count
}

export function getOldestMessage(chatJid: string): MessageRow | undefined {
  return db
    .prepare('SELECT * FROM messages WHERE chat_jid = ? ORDER BY ts ASC LIMIT 1')
    .get(chatJid) as MessageRow | undefined
}

export function getRecentMessages(chatJid: string, limit: number): MessageRow[] {
  return db
    .prepare('SELECT * FROM messages WHERE chat_jid = ? ORDER BY ts DESC LIMIT ?')
    .all(chatJid, limit) as MessageRow[]
}

export function insertDigest(input: Omit<DigestRow, 'id' | 'delivered_at' | 'delivery_error'>): number {
  const result = db
    .prepare(
      `INSERT INTO digests
        (chat_jid, chat_name, period_start, period_end, message_count, model, summary_md, tokens_in, tokens_out, trigger, created_at)
       VALUES (@chat_jid, @chat_name, @period_start, @period_end, @message_count, @model, @summary_md, @tokens_in, @tokens_out, @trigger, @created_at)`,
    )
    .run(input)
  return Number(result.lastInsertRowid)
}

export function markDigestDelivered(id: number, error?: string) {
  db.prepare('UPDATE digests SET delivered_at = ?, delivery_error = ? WHERE id = ?').run(
    error ? null : now(),
    error ?? null,
    id,
  )
}

export function listDigests(options: { chatJid?: string; limit?: number } = {}): DigestRow[] {
  const limit = options.limit ?? 50
  if (options.chatJid) {
    return db
      .prepare('SELECT * FROM digests WHERE chat_jid = ? ORDER BY created_at DESC LIMIT ?')
      .all(options.chatJid, limit) as DigestRow[]
  }
  return db.prepare('SELECT * FROM digests ORDER BY created_at DESC LIMIT ?').all(limit) as DigestRow[]
}

export function getDigest(id: number): DigestRow | undefined {
  return db.prepare('SELECT * FROM digests WHERE id = ?').get(id) as DigestRow | undefined
}

export function stats() {
  const messages = db.prepare('SELECT COUNT(*) AS count FROM messages').get() as { count: number }
  const chats = db.prepare('SELECT COUNT(*) AS count FROM chats').get() as { count: number }
  const tracked = db.prepare('SELECT COUNT(*) AS count FROM chats WHERE tracked = 1').get() as { count: number }
  const digests = db.prepare('SELECT COUNT(*) AS count FROM digests').get() as { count: number }
  const oldest = db.prepare('SELECT MIN(ts) AS ts FROM messages').get() as { ts: number | null }
  return {
    messages: messages.count,
    chats: chats.count,
    trackedChats: tracked.count,
    digests: digests.count,
    oldestMessageAt: oldest.ts,
  }
}

export function deleteMessagesOlderThan(cutoffTs: number): number {
  const result = db.prepare('DELETE FROM messages WHERE ts < ?').run(cutoffTs)
  db.prepare(
    `UPDATE chats SET
       message_count = (SELECT COUNT(*) FROM messages WHERE messages.chat_jid = chats.jid),
       last_message_at = (SELECT MAX(ts) FROM messages WHERE messages.chat_jid = chats.jid)`,
  ).run()
  return result.changes
}

export function getSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value
}

export function setSetting(key: string, value: string) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}
