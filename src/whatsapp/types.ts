import type { EventEmitter } from 'node:events'

export type ConnectionStatus =
  | 'starting'
  | 'need_pairing'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'logged_out'
  | 'error'

export interface HistorySyncProgress {
  chats: number
  messages: number
  isLatest: boolean
  progress: number | null
  updatedAt: number | null
}

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
  historySync: HistorySyncProgress
}

export interface WhatsappGateway {
  events: EventEmitter<{ state: [SessionState]; message: [void] }>
  start(): Promise<void>
  stop(): Promise<void>
  getState(): SessionState
  /** Разлогинивает связанное устройство и стирает ключи сессии — потребуется новый QR. */
  reset(): Promise<void>
  /** Просит WhatsApp прислать ещё одну порцию старой переписки для чата. */
  backfill(chatJid: string, batches: number): Promise<{ requested: number }>
  /** Скачивает фото, сохранённое при приёме сообщения. null — фото недоступно. */
  downloadImage(chatJid: string, messageId: string, fromMe: boolean, mediaJson: string): Promise<{
    buffer: Buffer
    mimetype: string
  } | null>
}
