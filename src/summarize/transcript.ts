import type { MessageRow } from '../db/repo.js'
import { getSettings } from '../settings.js'

function formatTime(ts: number, timezone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(ts * 1000)
}

function formatDay(ts: number, timezone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    timeZone: timezone,
  }).format(ts * 1000)
}

export function formatTranscript(messages: MessageRow[]): string {
  const { timezone } = getSettings()
  const lines: string[] = []
  let currentDay = ''

  for (const message of messages) {
    const day = formatDay(message.ts, timezone)
    if (day !== currentDay) {
      currentDay = day
      lines.push(`\n--- ${day} ---`)
    }

    const author = message.sender_name ?? (message.from_me ? 'Вы' : 'Участник')
    const quote = message.quoted_text ? ` (в ответ на: «${message.quoted_text}»)` : ''
    const mention = message.mentions_me ? ' [обращение к вам]' : ''
    const text = (message.text ?? '').replace(/\s+/g, ' ').trim()
    if (!text) continue

    lines.push(`[${formatTime(message.ts, timezone)}] ${author}${mention}: ${text}${quote}`)
  }

  return lines.join('\n').trim()
}

/** Режет сообщения на части так, чтобы каждая укладывалась в бюджет символов одного запроса. */
export function chunkMessages(messages: MessageRow[], maxChars: number): MessageRow[][] {
  const chunks: MessageRow[][] = []
  let current: MessageRow[] = []
  let currentChars = 0

  for (const message of messages) {
    const size = (message.text?.length ?? 0) + (message.sender_name?.length ?? 0) + 24
    if (current.length > 0 && currentChars + size > maxChars) {
      chunks.push(current)
      current = []
      currentChars = 0
    }
    current.push(message)
    currentChars += size
  }

  if (current.length > 0) chunks.push(current)
  return chunks
}

export function formatPeriod(from: number, to: number, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  })
  return `${formatter.format(from * 1000)} — ${formatter.format(to * 1000)}`
}
