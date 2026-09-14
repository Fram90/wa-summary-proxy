import fs from 'node:fs'
import path from 'node:path'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { z } from 'zod'
import { config } from '../config.js'
import { logger } from '../logger.js'
import {
  getChat,
  getDigest,
  getRecentMessages,
  listChats,
  listDigests,
  setChatTracked,
  stats,
} from '../db/repo.js'
import { getSettings, updateSettings } from '../settings.js'
import type { Scheduler } from '../scheduler.js'
import type { DigestService } from '../service/digest-service.js'
import type { TelegramNotifier } from '../telegram/bot.js'
import type { WhatsappGateway } from '../whatsapp/types.js'
import type { DemoGateway } from '../whatsapp/demo.js'

const webRoot = path.resolve(process.cwd(), 'web', 'dist')

export interface ServerDeps {
  gateway: WhatsappGateway
  service: DigestService
  scheduler: Scheduler
  notifier: TelegramNotifier
}

export async function createServer(deps: ServerDeps) {
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 })

  // Часть запросов не имеет тела вовсе, но приходит с заголовком JSON — не считаем это ошибкой.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const raw = typeof body === 'string' ? body.trim() : ''
    if (raw.length === 0) return done(null, {})

    try {
      done(null, JSON.parse(raw))
    } catch {
      const error = new Error('Тело запроса не является корректным JSON') as Error & { statusCode?: number }
      error.statusCode = 400
      done(error, undefined)
    }
  })

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/') || request.url.startsWith('/api/health')) return
    if (!config.DASHBOARD_TOKEN) return

    const header = request.headers['x-dashboard-token']
    const query = (request.query as Record<string, string> | undefined)?.token
    const provided = Array.isArray(header) ? header[0] : (header ?? query)

    if (provided !== config.DASHBOARD_TOKEN) {
      await reply.code(401).send({ error: 'Нужен токен панели' })
    }
  })

  app.get('/api/health', async () => ({ ok: true }))

  app.get('/api/state', async () => {
    const settings = getSettings()
    return {
      session: deps.gateway.getState(),
      stats: stats(),
      settings,
      nextRunAt: deps.scheduler.nextRunAt()?.toISOString() ?? null,
      telegram: { enabled: deps.notifier.enabled, chatId: settings.telegramChatId },
      llm: { enabled: config.llmEnabled, baseUrl: config.OPENAI_BASE_URL, model: settings.llmModel },
      authRequired: Boolean(config.DASHBOARD_TOKEN),
      demoMode: config.DEMO_MODE,
    }
  })

  app.post('/api/session/reset', async () => {
    await deps.gateway.reset()
    return { ok: true }
  })

  app.post('/api/session/demo-connect', async (_request, reply) => {
    if (!config.DEMO_MODE) {
      return reply.code(400).send({ error: 'Доступно только в демо-режиме' })
    }
    await (deps.gateway as DemoGateway).connect()
    return { ok: true }
  })

  app.get('/api/chats', async (request) => {
    const query = z
      .object({ query: z.string().optional(), tracked: z.enum(['0', '1']).optional() })
      .parse(request.query)

    return {
      chats: listChats({ query: query.query, onlyTracked: query.tracked === '1' }),
    }
  })

  app.post('/api/chats/:jid/track', async (request, reply) => {
    const { jid } = z.object({ jid: z.string() }).parse(request.params)
    const { tracked } = z.object({ tracked: z.boolean() }).parse(request.body)

    if (!getChat(jid)) return reply.code(404).send({ error: 'Чат не найден' })
    setChatTracked(jid, tracked)
    return { ok: true, jid, tracked }
  })

  app.get('/api/chats/:jid/messages', async (request) => {
    const { jid } = z.object({ jid: z.string() }).parse(request.params)
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(200).default(40) }).parse(request.query)
    return { messages: getRecentMessages(jid, limit).reverse() }
  })

  app.post('/api/chats/:jid/backfill', async (request, reply) => {
    const { jid } = z.object({ jid: z.string() }).parse(request.params)
    const { batches } = z.object({ batches: z.number().int().min(1).max(20).default(3) }).parse(request.body ?? {})

    try {
      const result = await deps.gateway.backfill(jid, batches)
      return { ok: true, ...result }
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message })
    }
  })

  app.get('/api/digests', async (request) => {
    const query = z
      .object({ chat: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) })
      .parse(request.query)
    return { digests: listDigests({ chatJid: query.chat, limit: query.limit }) }
  })

  app.get('/api/digests/:id', async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(request.params)
    const digest = getDigest(id)
    if (!digest) return reply.code(404).send({ error: 'Дайджест не найден' })
    return { digest }
  })

  app.post('/api/digests/run', async (request, reply) => {
    const body = z
      .object({
        chatJid: z.string().optional(),
        hours: z.number().int().min(1).max(336).optional(),
      })
      .parse(request.body ?? {})

    const hours = body.hours ?? getSettings().digestWindowHours

    try {
      if (body.chatJid) {
        const digest = await deps.service.runForChat({ chatJid: body.chatJid, hours, trigger: 'manual' })
        return { digests: digest ? [digest] : [] }
      }
      const digests = await deps.service.runForTrackedChats({ hours, trigger: 'manual' })
      return { digests }
    } catch (error) {
      logger.error({ err: error }, 'ручная сборка дайджеста не удалась')
      return reply.code(500).send({ error: (error as Error).message })
    }
  })

  app.put('/api/settings', async (request, reply) => {
    const body = z
      .object({
        digestCron: z.string().min(1).optional(),
        digestWindowHours: z.number().int().min(1).max(336).optional(),
        timezone: z.string().min(1).optional(),
        llmModel: z.string().min(1).optional(),
        retentionDays: z.number().int().min(1).max(3650).optional(),
        telegramChatId: z.string().nullable().optional(),
      })
      .parse(request.body)

    try {
      return { settings: updateSettings(body) }
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message })
    }
  })

  app.post('/api/telegram/test', async (_request, reply) => {
    if (!deps.notifier.enabled) return reply.code(400).send({ error: 'Telegram-бот не настроен' })
    await deps.notifier.sendAlert('Проверка связи из панели wa-digest — доставка работает.')
    return { ok: true }
  })

  if (fs.existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot })
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Не найдено' })
      }
      return reply.sendFile('index.html')
    })
  } else {
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Не найдено' })
      }
      return reply
        .code(200)
        .type('text/html; charset=utf-8')
        .send(
          '<h1>Панель не собрана</h1><p>Соберите её командой <code>npm --prefix web run build</code>, либо запустите dev-режим Vite.</p>',
        )
    })
  }

  return app
}
