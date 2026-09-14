const TELEGRAM_LIMIT = 4096
const SAFE_LIMIT = 3800

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Переводит Markdown от модели в подмножество HTML, которое понимает Telegram. */
export function markdownToTelegramHtml(markdown: string): string {
  return escapeHtml(markdown)
    .split('\n')
    .map((line) => {
      let result = line.replace(/^\s{0,3}#{1,6}\s+(.*)$/, '<b>$1</b>')
      result = result.replace(/^(\s*)[-*]\s+/, '$1• ')
      result = result.replace(/`([^`]+)`/g, '<code>$1</code>')
      result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
      result = result.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      result = result.replace(/(^|[\s(])_([^_]+)_(?=[\s.,!?)]|$)/g, '$1<i>$2</i>')
      return result
    })
    .join('\n')
}

/** Режет длинный текст по границам строк, чтобы не рвать HTML-теги. */
export function splitMessage(text: string, limit = SAFE_LIMIT): string[] {
  if (text.length <= limit) return [text]

  const parts: string[] = []
  let current = ''

  for (const line of text.split('\n')) {
    if (line.length > limit) {
      if (current) {
        parts.push(current)
        current = ''
      }
      for (let index = 0; index < line.length; index += limit) {
        parts.push(line.slice(index, index + limit))
      }
      continue
    }

    if (current.length + line.length + 1 > limit) {
      parts.push(current)
      current = line
    } else {
      current = current ? `${current}\n${line}` : line
    }
  }

  if (current) parts.push(current)
  return parts.filter((part) => part.trim().length > 0).map((part) => part.slice(0, TELEGRAM_LIMIT))
}
