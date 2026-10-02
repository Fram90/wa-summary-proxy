import { EventEmitter } from 'node:events'
import { z } from 'zod'
import { config } from './config.js'
import { getSetting, setSetting } from './db/repo.js'

const settingsSchema = z.object({
  digestCron: z.string().min(1),
  digestWindowHours: z.number().int().min(1).max(24 * 14),
  timezone: z.string().min(1),
  llmModel: z.string().min(1),
  /** Куда слать дайджесты: личка или id группы (отрицательное число). */
  telegramChatId: z.string().nullable(),
  /** User id того, кто может командовать ботом. В личке совпадает с chat id. */
  telegramOwnerId: z.string().nullable(),
  retentionDays: z.number().int().min(1).max(3650),
})

export type AppSettings = z.infer<typeof settingsSchema>

const SETTINGS_KEY = 'app'

const defaults: AppSettings = {
  digestCron: config.DIGEST_CRON,
  digestWindowHours: config.DIGEST_WINDOW_HOURS,
  timezone: config.DIGEST_TZ,
  llmModel: config.LLM_MODEL,
  telegramChatId: config.TELEGRAM_CHAT_ID ?? null,
  telegramOwnerId: null,
  retentionDays: config.RETENTION_DAYS,
}

export const settingsEvents = new EventEmitter<{ change: [AppSettings] }>()

let cache: AppSettings | null = null

export function getSettings(): AppSettings {
  if (cache) return cache

  const raw = getSetting(SETTINGS_KEY)
  if (!raw) {
    cache = defaults
    return cache
  }

  const parsed = settingsSchema.safeParse({ ...defaults, ...JSON.parse(raw) })
  const data = parsed.success ? parsed.data : defaults
  // Раньше в telegramChatId хранилась личка, и она же была единственным допуском.
  if (!data.telegramOwnerId && data.telegramChatId && !data.telegramChatId.startsWith('-')) {
    data.telegramOwnerId = data.telegramChatId
  }
  cache = data
  return cache
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next = settingsSchema.parse({ ...getSettings(), ...patch })
  setSetting(SETTINGS_KEY, JSON.stringify(next))
  cache = next
  settingsEvents.emit('change', next)
  return next
}
