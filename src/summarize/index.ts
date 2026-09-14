import OpenAI from 'openai'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { getChat, getMessagesInWindow, insertDigest, markChatDigested, type MessageRow } from '../db/repo.js'
import { getSettings } from '../settings.js'
import { chunkPrompt, reducePrompt, singlePassPrompt, systemPrompt } from './prompts.js'
import { chunkMessages, formatPeriod, formatTranscript } from './transcript.js'

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
}

export type DigestTrigger = 'schedule' | 'manual' | 'telegram'

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
function fakeSummary(chatName: string, messages: MessageRow[]): string {
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
  ].join('\n')
}

export async function buildDigest(options: {
  chatJid: string
  from: number
  to: number
  trigger: DigestTrigger
}): Promise<DigestResult | null> {
  const settings = getSettings()
  const chat = getChat(options.chatJid)
  const chatName = chat?.name ?? options.chatJid
  const messages = getMessagesInWindow(options.chatJid, options.from, options.to).filter((message) => message.text)

  if (messages.length === 0) {
    logger.info({ chatJid: options.chatJid }, 'нет сообщений за период, дайджест не нужен')
    return null
  }

  const period = formatPeriod(options.from, options.to, settings.timezone)
  const useFake = config.DEMO_MODE && !config.llmEnabled

  let summaryMd: string
  let tokensIn = 0
  let tokensOut = 0

  if (useFake) {
    summaryMd = fakeSummary(chatName, messages)
  } else {
    const chunks = chunkMessages(messages, config.LLM_CHUNK_CHARS)
    logger.info({ chatJid: options.chatJid, messages: messages.length, chunks: chunks.length }, 'собираю дайджест')

    if (chunks.length === 1) {
      const result = await complete(settings.llmModel, singlePassPrompt(chatName, period, formatTranscript(messages)))
      summaryMd = result.text
      tokensIn = result.tokensIn
      tokensOut = result.tokensOut
    } else {
      const notes: string[] = []
      for (const [index, chunk] of chunks.entries()) {
        const result = await complete(
          settings.llmModel,
          chunkPrompt(index + 1, chunks.length, formatTranscript(chunk)),
        )
        notes.push(result.text)
        tokensIn += result.tokensIn
        tokensOut += result.tokensOut
      }

      const reduced = await complete(settings.llmModel, reducePrompt(chatName, period, notes))
      summaryMd = reduced.text
      tokensIn += reduced.tokensIn
      tokensOut += reduced.tokensOut
    }
  }

  const model = useFake ? 'demo' : settings.llmModel
  const id = insertDigest({
    chat_jid: options.chatJid,
    chat_name: chatName,
    period_start: options.from,
    period_end: options.to,
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
    id,
    chatJid: options.chatJid,
    chatName,
    summaryMd,
    messageCount: messages.length,
    periodStart: options.from,
    periodEnd: options.to,
    model,
    tokensIn,
    tokensOut,
  }
}
