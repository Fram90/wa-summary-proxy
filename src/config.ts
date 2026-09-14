import 'dotenv/config'
import path from 'node:path'
import { z } from 'zod'

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') return value
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
  })

const schema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(43117),
  DATA_DIR: z.string().default('./data'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  DEMO_MODE: booleanish.default(false),

  /** Оставьте пустым, только если панель недоступна из интернета. */
  DASHBOARD_TOKEN: z.string().min(8).optional(),

  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  LLM_MODEL: z.string().default('gpt-4o-mini'),
  /** Бюджет символов на один запрос к модели; при превышении диалог режется на части. */
  LLM_CHUNK_CHARS: z.coerce.number().int().min(4000).default(40_000),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(180_000),

  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  /** Ваш личный chat id. Если не знаете — оставьте пустым и напишите боту /start. */
  TELEGRAM_CHAT_ID: z.string().optional(),

  DIGEST_CRON: z.string().default('0 9,21 * * *'),
  DIGEST_TZ: z.string().default('Europe/Moscow'),
  /** Сколько часов переписки попадает в плановый дайджест. */
  DIGEST_WINDOW_HOURS: z.coerce.number().int().min(1).default(12),
  RETENTION_DAYS: z.coerce.number().int().min(1).default(30),

  WA_SYNC_FULL_HISTORY: booleanish.default(true),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n')
  throw new Error(`Некорректные переменные окружения:\n${issues}`)
}

const env = parsed.data
const dataDir = path.resolve(process.cwd(), env.DATA_DIR)

export const config = {
  ...env,
  dataDir,
  authDir: path.join(dataDir, 'auth'),
  dbPath: path.join(dataDir, 'wa-digest.db'),
  isDev: process.env.NODE_ENV !== 'production',
  llmEnabled: Boolean(env.OPENAI_API_KEY),
  telegramEnabled: Boolean(env.TELEGRAM_BOT_TOKEN),
}

export type Config = typeof config
