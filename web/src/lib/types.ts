export type ConnectionStatus =
  | 'starting'
  | 'need_pairing'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'logged_out'
  | 'error'

export interface SessionState {
  status: ConnectionStatus
  demo: boolean
  qr: { dataUrl: string; expiresAt: number } | null
  me: { id: string; name: string | null } | null
  connectedAt: number | null
  lastDisconnectAt: number | null
  lastError: string | null
  lastDisconnectCode: number | null
  reconnectAttempts: number
  historySync: {
    chats: number
    messages: number
    isLatest: boolean
    progress: number | null
    updatedAt: number | null
  }
}

export interface AppSettings {
  digestCron: string
  digestWindowHours: number
  timezone: string
  llmModel: string
  telegramChatId: string | null
  retentionDays: number
}

export interface AppState {
  session: SessionState
  stats: {
    messages: number
    chats: number
    trackedChats: number
    digests: number
    oldestMessageAt: number | null
  }
  settings: AppSettings
  nextRunAt: string | null
  telegram: { enabled: boolean; chatId: string | null }
  llm: { enabled: boolean; baseUrl: string; model: string }
  authRequired: boolean
  demoMode: boolean
}

export interface Chat {
  jid: string
  name: string | null
  is_group: number
  tracked: number
  last_message_at: number | null
  message_count: number
  last_digest_at: number | null
  extra_prompt: string | null
}

export interface Message {
  id: string
  chat_jid: string
  sender_name: string | null
  ts: number
  from_me: number
  kind: string
  text: string | null
  quoted_text: string | null
  mentions_me: number
}

export interface Digest {
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
