export function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

export function countWithNoun(count: number, one: string, few: string, many: string): string {
  return `${count.toLocaleString('ru-RU')} ${plural(count, one, few, many)}`
}

export function formatDateTime(tsSeconds: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(tsSeconds * 1000)
}

export function formatRelative(tsSeconds: number | null): string {
  if (!tsSeconds) return 'никогда'

  const diffSeconds = Math.floor(Date.now() / 1000) - tsSeconds
  if (diffSeconds < -60) return formatUntil(tsSeconds)
  if (diffSeconds < 60) return 'только что'
  if (diffSeconds < 3600) {
    const minutes = Math.floor(diffSeconds / 60)
    return `${countWithNoun(minutes, 'минуту', 'минуты', 'минут')} назад`
  }
  if (diffSeconds < 86_400) {
    const hours = Math.floor(diffSeconds / 3600)
    return `${countWithNoun(hours, 'час', 'часа', 'часов')} назад`
  }
  const days = Math.floor(diffSeconds / 86_400)
  if (days < 30) return `${countWithNoun(days, 'день', 'дня', 'дней')} назад`
  return formatDateTime(tsSeconds)
}

/** Для моментов в будущем: «через 4 часа». */
export function formatUntil(tsSeconds: number): string {
  const diffSeconds = tsSeconds - Math.floor(Date.now() / 1000)
  if (diffSeconds <= 60) return 'вот-вот'

  if (diffSeconds < 3600) {
    const minutes = Math.round(diffSeconds / 60)
    return `через ${countWithNoun(minutes, 'минуту', 'минуты', 'минут')}`
  }
  if (diffSeconds < 86_400) {
    const hours = Math.round(diffSeconds / 3600)
    return `через ${countWithNoun(hours, 'час', 'часа', 'часов')}`
  }

  const days = Math.round(diffSeconds / 86_400)
  return `через ${countWithNoun(days, 'день', 'дня', 'дней')}`
}

export function formatPeriod(from: number, to: number): string {
  return `${formatDateTime(from)} — ${formatDateTime(to)}`
}

export function formatChatName(chat: { name: string | null; jid: string }): string {
  if (chat.name) return chat.name
  const local = chat.jid.split('@')[0] ?? chat.jid
  return chat.jid.endsWith('@g.us') ? `Группа ${local.slice(-6)}` : `+${local}`
}

export function describeCron(expression: string): string {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return 'нестандартное расписание'

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  if (dayOfMonth !== '*' || month !== '*' || dayOfWeek !== '*') return 'нестандартное расписание'
  if (!minute || !hour || !/^\d+$/.test(minute)) return 'нестандартное расписание'

  const hours = hour.split(',')
  if (!hours.every((value) => /^\d+$/.test(value))) return 'нестандартное расписание'

  const times = hours.map((value) => `${value.padStart(2, '0')}:${minute.padStart(2, '0')}`)
  return `каждый день в ${times.join(' и ')}`
}
