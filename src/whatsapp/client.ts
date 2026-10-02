import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys'
import NodeCache from 'node-cache'
import QRCode from 'qrcode'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { getOldestMessage, renameChat, saveMessages, upsertChat } from '../db/repo.js'
import { toIncomingMessage } from './message.js'
import { describeDisconnect, disconnectCode } from './disconnect.js'
import { downloadImageSnapshot } from './media.js'
import type { SessionState, WhatsappGateway } from './types.js'

const QR_TTL_MS = 60_000
const MAX_BACKOFF_MS = 60_000

export class BaileysGateway implements WhatsappGateway {
  readonly events = new EventEmitter<{ state: [SessionState]; message: [void] }>()

  private socket: WASocket | null = null
  private groupCache = new NodeCache({ stdTTL: 300, useClones: false })
  private chatNames = new Map<string, string>()
  private reconnectTimer: NodeJS.Timeout | null = null
  private stopped = false
  private generation = 0
  private waLogger = logger.child({ module: 'baileys' }, { level: 'warn' })

  private state: SessionState = {
    status: 'starting',
    demo: false,
    qr: null,
    me: null,
    connectedAt: null,
    lastDisconnectAt: null,
    lastError: null,
    lastDisconnectCode: null,
    reconnectAttempts: 0,
    historySync: { chats: 0, messages: 0, isLatest: false, progress: null, updatedAt: null },
  }

  getState(): SessionState {
    return { ...this.state, historySync: { ...this.state.historySync } }
  }

  private patchState(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch }
    this.events.emit('state', this.getState())
  }

  async start(): Promise<void> {
    this.stopped = false
    const generation = ++this.generation
    await fs.mkdir(config.authDir, { recursive: true })

    const { state: authState, saveCreds } = await useMultiFileAuthState(config.authDir)
    // Живая версия web.whatsapp.com, а не устаревший список из репозитория Baileys.
    const { version } = await fetchLatestWaWebVersion({}).catch((error) => {
      logger.warn({ err: error }, 'не удалось узнать актуальную версию WhatsApp Web, беру встроенную')
      return { version: undefined as unknown as [number, number, number] }
    })

    const socket = makeWASocket({
      ...(version ? { version } : {}),
      auth: {
        creds: authState.creds,
        keys: makeCacheableSignalKeyStore(authState.keys, this.waLogger),
      },
      logger: this.waLogger,
      // WhatsApp с июня 2026 отклоняет профиль Desktop (WIN32/DARWIN) кодом 428
      // ещё до выдачи QR. Chrome объявляет себя как обычный браузер.
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: config.WA_SYNC_FULL_HISTORY,
      shouldSyncHistoryMessage: () => config.WA_SYNC_FULL_HISTORY,
      // Иначе телефон решит, что вы за компьютером, и перестанет присылать пуши.
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      cachedGroupMetadata: async (jid) => this.groupCache.get(jid),
      getMessage: async () => undefined,
    })

    this.socket = socket
    this.patchState({
      status: authState.creds.registered ? 'connecting' : 'need_pairing',
      me: authState.creds.me ? { id: authState.creds.me.id, name: authState.creds.me.name ?? null } : null,
    })

    socket.ev.on('creds.update', saveCreds)
    socket.ev.on('connection.update', (update) => {
      if (this.generation !== generation) return
      void this.onConnectionUpdate(update)
    })

    socket.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest, progress }) => {
      for (const chat of chats) {
        const name = chat.name ?? undefined
        if (name) this.chatNames.set(chat.id, name)
        upsertChat({ jid: chat.id, name: name ?? null, isGroup: chat.id.endsWith('@g.us') })
      }
      for (const contact of contacts) {
        const name = contact.name ?? contact.notify ?? undefined
        if (name && contact.id) this.chatNames.set(jidNormalizedUser(contact.id), name)
      }

      const saved = this.ingest(messages)
      this.patchState({
        historySync: {
          chats: this.state.historySync.chats + chats.length,
          messages: this.state.historySync.messages + saved,
          isLatest: Boolean(isLatest),
          progress: progress ?? null,
          updatedAt: Date.now(),
        },
      })
      logger.info(
        { chats: chats.length, messages: messages.length, saved, progress },
        'получена порция истории переписки',
      )
    })

    socket.ev.on('messages.upsert', ({ messages }) => {
      const saved = this.ingest(messages)
      if (saved > 0) this.events.emit('message')
    })

    socket.ev.on('chats.upsert', (chats) => {
      for (const chat of chats) {
        if (chat.name) this.chatNames.set(chat.id, chat.name)
        upsertChat({ jid: chat.id, name: chat.name ?? null, isGroup: chat.id.endsWith('@g.us') })
      }
    })

    socket.ev.on('chats.update', (updates) => {
      for (const update of updates) {
        if (update.id && update.name) {
          this.chatNames.set(update.id, update.name)
          renameChat(update.id, update.name)
        }
      }
    })

    socket.ev.on('contacts.upsert', (contacts) => {
      for (const contact of contacts) {
        const name = contact.name ?? contact.notify
        if (contact.id && name) {
          const jid = jidNormalizedUser(contact.id)
          this.chatNames.set(jid, name)
          renameChat(jid, name)
        }
      }
    })

    socket.ev.on('groups.upsert', (groups) => {
      for (const group of groups) {
        this.groupCache.set(group.id, group)
        if (group.subject) {
          this.chatNames.set(group.id, group.subject)
          upsertChat({ jid: group.id, name: group.subject, isGroup: true })
        }
      }
    })

    socket.ev.on('groups.update', async ([event]) => {
      if (!event?.id) return
      if (event.subject) {
        this.chatNames.set(event.id, event.subject)
        renameChat(event.id, event.subject)
      }
      await this.refreshGroupMetadata(event.id)
    })

    socket.ev.on('group-participants.update', async (event) => {
      await this.refreshGroupMetadata(event.id)
    })
  }

  private async refreshGroupMetadata(jid: string) {
    try {
      const metadata = await this.socket?.groupMetadata(jid)
      if (metadata) this.groupCache.set(jid, metadata)
    } catch (error) {
      logger.debug({ err: error, jid }, 'не удалось обновить метаданные группы')
    }
  }

  private ingest(messages: Parameters<typeof toIncomingMessage>[0][]): number {
    const meJid = this.state.me?.id ? jidNormalizedUser(this.state.me.id) : null
    const prepared = messages
      .map((message) =>
        toIncomingMessage(message, {
          meJid,
          chatName: message.key.remoteJid ? (this.chatNames.get(message.key.remoteJid) ?? null) : null,
        }),
      )
      .filter((message): message is NonNullable<typeof message> => message !== null)

    if (prepared.length === 0) return 0
    return saveMessages(prepared)
  }

  private async onConnectionUpdate(update: {
    connection?: string
    lastDisconnect?: { error?: Error | undefined } | null
    qr?: string
  }) {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 512 })
      this.patchState({ status: 'need_pairing', qr: { dataUrl, expiresAt: Date.now() + QR_TTL_MS } })

      // Дублируем в консоль: на VDS часто удобнее отсканировать прямо из ssh-сессии.
      const terminalQr = await QRCode.toString(qr, { type: 'terminal', small: true })
      logger.info(
        `\nОтсканируйте QR в WhatsApp: Настройки -> Связанные устройства -> Привязка устройства\n${terminalQr}`,
      )
    }

    if (connection === 'connecting') {
      this.patchState({ status: this.state.status === 'need_pairing' ? 'need_pairing' : 'connecting' })
    }

    if (connection === 'open') {
      const me = this.socket?.user
      this.patchState({
        status: 'open',
        qr: null,
        connectedAt: Date.now(),
        lastError: null,
        reconnectAttempts: 0,
        me: me ? { id: me.id, name: me.name ?? me.verifiedName ?? null } : this.state.me,
      })
      logger.info({ me: me?.id }, 'WhatsApp подключён как связанное устройство')
    }

    if (connection === 'close') {
      const statusCode = disconnectCode(lastDisconnect?.error)
      const loggedOut = statusCode === DisconnectReason.loggedOut
      const lastError = describeDisconnect(statusCode, lastDisconnect?.error?.message)

      this.patchState({
        status: loggedOut ? 'logged_out' : 'reconnecting',
        lastDisconnectAt: Date.now(),
        lastError,
        lastDisconnectCode: statusCode ?? null,
        qr: null,
      })

      logger.warn({ statusCode, message: lastDisconnect?.error?.message }, lastError)

      if (loggedOut) {
        logger.error('устройство отвязано в WhatsApp — нужна повторная привязка по QR')
        return
      }

      if (this.stopped) return
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return

    const attempt = this.state.reconnectAttempts + 1
    const delay = Math.min(1000 * 2 ** Math.min(attempt, 6), MAX_BACKOFF_MS)
    this.patchState({ reconnectAttempts: attempt })
    logger.warn({ attempt, delay }, 'соединение с WhatsApp потеряно, переподключаюсь')

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.restart()
    }, delay)
  }

  private async restart() {
    try {
      this.socket?.end(undefined)
    } catch {
      // сокет уже мёртв, это нормально
    }
    this.socket = null
    if (this.stopped) return

    try {
      await this.start()
    } catch (error) {
      logger.error({ err: error }, 'не удалось перезапустить соединение с WhatsApp')
      this.patchState({ status: 'error', lastError: (error as Error).message })
      this.scheduleReconnect()
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    try {
      this.socket?.end(undefined)
    } catch {
      // игнорируем
    }
    this.socket = null
  }

  async reset(): Promise<void> {
    try {
      await this.socket?.logout()
    } catch (error) {
      logger.warn({ err: error }, 'logout не удался, всё равно стираю ключи сессии')
    }
    await this.stop()
    await fs.rm(config.authDir, { recursive: true, force: true })
    this.patchState({
      status: 'need_pairing',
      me: null,
      qr: null,
      connectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      lastDisconnectCode: null,
      historySync: { chats: 0, messages: 0, isLatest: false, progress: null, updatedAt: null },
    })
    await this.start()
  }

  async downloadImage(chatJid: string, messageId: string, fromMe: boolean, mediaJson: string) {
    if (!this.socket || this.state.status !== 'open') return null
    const waId = messageId.startsWith(`${chatJid}:`) ? messageId.slice(chatJid.length + 1) : messageId
    return downloadImageSnapshot(this.socket, chatJid, waId, fromMe, mediaJson)
  }

  async backfill(chatJid: string, batches: number): Promise<{ requested: number }> {
    if (!this.socket || this.state.status !== 'open') {
      throw new Error('WhatsApp не подключён')
    }

    let requested = 0
    for (let i = 0; i < batches; i += 1) {
      const oldest = getOldestMessage(chatJid)
      if (!oldest) throw new Error('в этом чате пока нет ни одного сообщения — история нужна как точка отсчёта')

      const messageId = oldest.id.slice(chatJid.length + 1)
      await this.socket.fetchMessageHistory(
        50,
        { remoteJid: chatJid, id: messageId, fromMe: oldest.from_me === 1, participant: oldest.sender_jid ?? undefined },
        oldest.ts,
      )
      requested += 50

      // История приходит асинхронно в messaging-history.set, поэтому даём ей время дойти.
      await new Promise((resolve) => setTimeout(resolve, 2500))
    }

    return { requested }
  }
}
