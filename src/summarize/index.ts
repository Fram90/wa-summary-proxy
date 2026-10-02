import OpenAI from 'openai'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { getChat, getMessagesInWindow, insertDigest, latestDigestEnd, markChatDigested, type MessageRow } from '../db/repo.js'
import { getSettings } from '../settings.js'
import { chunkPrompt, reducePrompt, singlePassPrompt, systemPrompt } from './prompts.js'
import { chunkMessages, formatPeriod, formatTranscript } from './transcript.js'

export interface DigestPhoto {
  messageId: string
  chatJid: string
  fromMe: boolean
  mediaJson: string
  senderName: string | null
  ts: number
  caption: string | null
}

export interface DigestResult {
  id: number
  chatJid: string
  chatName: string
  summaryMd: string
  messageCount: number
  periodStart: number
  periodEnd: number
  model: string
  tokensIn: number
  tokensOut: number
  photos: DigestPhoto[]
}

export type SkipReason = 'no_new' | 'empty'

export interface DigestSkip {
  chatJid: string
  chatName: string
  reason: SkipReason
}

export interface DigestRunReport {
  digests: DigestResult[]
  skipped: DigestSkip[]
}

export type DigestTrigger = 'schedule' | 'manual' | 'telegram'

const MAX_FORWARDED_PHOTOS = 12

/** Картинки и прочие вложения без подписи: модели тут нечего читать. */
function isMediaPlaceholder(text: string | null): boolean {
  const value = text?.trim() ?? ''
  return /^\[(фото|стикер|гиф|видео|аудио|голосовое|геолокация|контакт|опрос)(\s[^\]]*)?\]$/.test(value)
}

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!config.OPENAI_API_KEY) {
    throw new Error(
      'Не задан OPENAI_API_KEY. Укажите ключ в .env — подойдёт любой OpenAI-совместимый провайдер через OPENAI_BASE_URL.',
    )
  }
  client ??= new OpenAI({
    apiKey: config.OPENAI_API_KEY,
    baseURL: config.OPENAI_BASE_URL,
    timeout: config.LLM_TIMEOUT_MS,
    maxRetries: 2,
  })
  return client
}

interface CompletionResult {
  text: string
  tokensIn: number
  tokensOut: number
}

async function complete(model: string, userPrompt: string): Promise<CompletionResult> {
  const response = await getClient().chat.completions.create({
    model,
    temperature: 0.3,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })

  const text = response.choices[0]?.message?.content?.trim()
  if (!text) throw new Error('модель вернула пустой ответ')

  return {
    text,
    tokensIn: response.usage?.prompt_tokens ?? 0,
    tokensOut: response.usage?.completion_tokens ?? 0,
  }
}

/** В демо-режиме без ключа собираем дайджест локально, чтобы сценарий можно было пройти целиком. */
function fakeSummary(chatName: string, messages: MessageRow[], extra?: string | null): string {
  const authors = new Map<string, number>()
  for (const message of messages) {
    const author = message.sender_name ?? 'Участник'
    authors.set(author, (authors.get(author) ?? 0) + 1)
  }
  const top = [...authors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const mentions = messages.filter((message) => message.mentions_me === 1)
  const files = messages.filter((message) => message.kind === 'document')

  return [
    `**Коротко:** демо-дайджест по чату «${chatName}»: ${messages.length} сообщений от ${authors.size} участников. Настоящая выжимка появится, когда в \`.env\` будет указан \`OPENAI_API_KEY\`.`,
    '',
    '**О чём говорили**',
    ...messages.slice(-6).map((message) => `- ${message.sender_name ?? 'Участник'}: ${(message.text ?? '').slice(0, 140)}`),
    '',
    '**Решения и договорённости**',
    '- в демо-режиме решения не извлекаются: это делает языковая модель',
    '',
    '**Требует вашего внимания**',
    ...(mentions.length > 0
      ? mentions.slice(0, 4).map((message) => `- ${message.sender_name ?? 'Участник'}: ${(message.text ?? '').slice(0, 140)}`)
      : ['- прямых обращений к вам не было']),
    ...(files.length > 0
      ? ['', '**Цифры, ссылки и файлы**', ...files.slice(0, 5).map((message) => `- ${message.text}`)]
      : []),
    '',
    '**Кто писал больше всех**',
    `- ${top.map(([name, count]) => `${name} (${count})`).join(', ')}`,
    ...(extra?.trim()
      ? ['', '**По вашему промпту**', '- демо-режим не вызывает модель; промпт применится, когда будет задан OPENAI_API_KEY']
      : []),
  ].join('\n')
}

export async function buildDigest(options: {
  chatJid: string
  from: number
  to: number
  trigger: DigestTrigger
  /** Повторно прогнать окно, даже если эти сообщения уже были в дайджесте. */
  force?: boolean
}): Promise<{ digest: DigestResult } | { skip: DigestSkip }> {
  const settings = getSettings()
  const chat = getChat(options.chatJid)
  const chatName = chat?.name ?? options.chatJid
  const extra = chat?.extra_prompt ?? null
  const previousEnd = options.force ? null : latestDigestEnd(options.chatJid)
  const lower = previousEnd != null ? Math.max(options.from, previousEnd) : options.from
  const exclusive = previousEnd != null && previousEnd >= options.from

  const messages = (exclusive
    ? getMessagesInWindow(options.chatJid, previousEnd + 1, options.to)
    : getMessagesInWindow(options.chatJid, lower, options.to)
  ).filter((message) => message.text)

  if (messages.length === 0) {
    const reason: SkipReason = previousEnd != null ? 'no_new' : 'empty'
    logger.info({ chatJid: options.chatJid, reason }, 'дайджест не нужен')
    return { skip: { chatJid: options.chatJid, chatName, reason } }
  }

  const periodStart = messages[0]?.ts ?? lower
  const periodEnd = options.to
  const period = formatPeriod(periodStart, periodEnd, settings.timezone)
  const forwardPhotos = Boolean(extra?.trim())
  const photos = forwardPhotos ? collectPhotos(messages) : []
  const overflow = Math.max(0, photosSourceCount(messages, forwardPhotos) - photos.length)
  const needsModel = messages.some((message) => !isMediaPlaceholder(message.text))
  const useFake = config.DEMO_MODE && !config.llmEnabled

  let summaryMd: string
  let tokensIn = 0
  let tokensOut = 0
  let model = settings.llmModel

  if (!needsModel) {
    model = 'none'
    summaryMd = [
      '**Коротко:** новых текстовых сообщений нет, модель не вызывалась.',
      photos.length > 0 ? `\n**Фото**\n${photoNote(photos.length, overflow)}` : '',
    ].join('\n')
  } else if (useFake) {
    model = 'demo'
    summaryMd = fakeSummary(chatName, messages, extra)
  } else {
    const chunks = chunkMessages(messages, config.LLM_CHUNK_CHARS)
    logger.info({ chatJid: options.chatJid, messages: messages.length, chunks: chunks.length }, 'собираю дайджест')

    if (chunks.length === 1) {
      const result = await complete(
        settings.llmModel,
        singlePassPrompt(chatName, period, formatTranscript(messages), extra),
      )
      summaryMd = result.text
      tokensIn = result.tokensIn
      tokensOut = result.tokensOut
    } else {
      const notes: string[] = []
      for (const [index, chunk] of chunks.entries()) {
        const result = await complete(
          settings.llmModel,
          chunkPrompt(index + 1, chunks.length, formatTranscript(chunk), extra),
        )
        notes.push(result.text)
        tokensIn += result.tokensIn
        tokensOut += result.tokensOut
      }

      const reduced = await complete(settings.llmModel, reducePrompt(chatName, period, notes, extra))
      summaryMd = reduced.text
      tokensIn += reduced.tokensIn
      tokensOut += reduced.tokensOut
    }
  }

  if (needsModel && photos.length > 0) {
    summaryMd += `\n\n**Фото**\n${photoNote(photos.length, overflow)}`
  }

  const id = insertDigest({
    chat_jid: options.chatJid,
    chat_name: chatName,
    period_start: periodStart,
    period_end: periodEnd,
    message_count: messages.length,
    model,
    summary_md: summaryMd,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    trigger: options.trigger,
    created_at: Math.floor(Date.now() / 1000),
  })

  markChatDigested(options.chatJid, Math.floor(Date.now() / 1000))

  return {
    digest: {
      id,
      chatJid: options.chatJid,
      chatName,
      summaryMd,
      messageCount: messages.length,
      periodStart,
      periodEnd,
      model,
      tokensIn,
      tokensOut,
      photos,
    },
  }
}

function photosSourceCount(messages: MessageRow[], forward: boolean): number {
  if (!forward) return 0
  return messages.filter((message) => message.kind === 'image' && message.media_json).length
}

function collectPhotos(messages: MessageRow[]): DigestPhoto[] {
  return messages
    .filter((message) => message.kind === 'image' && message.media_json)
    .slice(-MAX_FORWARDED_PHOTOS)
    .map((message) => ({
      messageId: message.id,
      chatJid: message.chat_jid,
      fromMe: message.from_me === 1,
      mediaJson: message.media_json as string,
      senderName: message.sender_name,
      ts: message.ts,
      caption: isMediaPlaceholder(message.text) ? null : message.text,
    }))
}

function photoNote(forwarded: number, overflow: number): string {
  const sent = `${forwarded} фото уйдут в Telegram отдельными сообщениями. Содержимое картинок модель не смотрит.`
  if (overflow <= 0) return sent
  return `${sent} Ещё ${overflow} старше этого лимита не пересылаются.`
}
