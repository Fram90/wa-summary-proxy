import { jidNormalizedUser, type WAMessage, type WAMessageContent } from '@whiskeysockets/baileys'
import type { IncomingMessage } from '../db/repo.js'

export interface ExtractedContent {
  kind: string
  text: string | null
}

/** Разворачивает служебные обёртки: исчезающие сообщения, «просмотр один раз», документы с подписью, правки. */
function unwrap(content: WAMessageContent | null | undefined): WAMessageContent | null {
  let current = content ?? null
  for (let depth = 0; current && depth < 6; depth += 1) {
    const next =
      current.ephemeralMessage?.message ??
      current.viewOnceMessage?.message ??
      current.viewOnceMessageV2?.message ??
      current.viewOnceMessageV2Extension?.message ??
      current.documentWithCaptionMessage?.message ??
      current.editedMessage?.message ??
      current.protocolMessage?.editedMessage ??
      null
    if (!next) return current
    current = next
  }
  return current
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return ''
  const total = Math.round(seconds)
  if (total < 60) return ` ${total} сек`
  return ` ${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function describe(content: WAMessageContent): ExtractedContent | null {
  if (content.conversation) {
    return { kind: 'text', text: content.conversation }
  }

  if (content.extendedTextMessage) {
    const { text, title, matchedText } = content.extendedTextMessage
    const link = matchedText && title ? `\n[ссылка: ${title} — ${matchedText}]` : ''
    return { kind: 'text', text: `${text ?? ''}${link}`.trim() || null }
  }

  if (content.imageMessage) {
    return { kind: 'image', text: content.imageMessage.caption?.trim() || '[фото]' }
  }

  if (content.videoMessage) {
    const isGif = content.videoMessage.gifPlayback
    const label = isGif ? '[гиф]' : '[видео]'
    return { kind: 'video', text: content.videoMessage.caption?.trim() || label }
  }

  if (content.audioMessage) {
    const duration = formatDuration(content.audioMessage.seconds)
    const isVoice = content.audioMessage.ptt
    return {
      kind: isVoice ? 'voice' : 'audio',
      text: isVoice ? `[голосовое${duration}]` : `[аудио${duration}]`,
    }
  }

  if (content.documentMessage) {
    const name = content.documentMessage.fileName ?? 'без названия'
    const caption = content.documentMessage.caption?.trim()
    return { kind: 'document', text: caption ? `[файл: ${name}] ${caption}` : `[файл: ${name}]` }
  }

  if (content.stickerMessage) {
    return { kind: 'sticker', text: '[стикер]' }
  }

  if (content.pollCreationMessage || content.pollCreationMessageV2 || content.pollCreationMessageV3) {
    const poll = content.pollCreationMessage ?? content.pollCreationMessageV2 ?? content.pollCreationMessageV3
    const options = (poll?.options ?? []).map((option) => option.optionName).filter(Boolean).join(' / ')
    return { kind: 'poll', text: `[опрос: ${poll?.name ?? ''}${options ? ` — ${options}` : ''}]`.trim() }
  }

  if (content.locationMessage || content.liveLocationMessage) {
    const name = content.locationMessage?.name ?? content.locationMessage?.address
    return { kind: 'location', text: name ? `[геолокация: ${name}]` : '[геолокация]' }
  }

  if (content.contactMessage || content.contactsArrayMessage) {
    const name = content.contactMessage?.displayName
    return { kind: 'contact', text: name ? `[контакт: ${name}]` : '[контакт]' }
  }

  if (content.reactionMessage) {
    const emoji = content.reactionMessage.text
    return emoji ? { kind: 'reaction', text: `[реакция ${emoji}]` } : null
  }

  if (content.groupInviteMessage) {
    return { kind: 'system', text: `[приглашение в группу: ${content.groupInviteMessage.groupName ?? ''}]`.trim() }
  }

  return null
}

function quotedText(content: WAMessageContent): string | null {
  const contextInfo =
    content.extendedTextMessage?.contextInfo ??
    content.imageMessage?.contextInfo ??
    content.videoMessage?.contextInfo ??
    content.audioMessage?.contextInfo ??
    content.documentMessage?.contextInfo ??
    null

  const quoted = contextInfo?.quotedMessage
  if (!quoted) return null

  const described = describe(unwrap(quoted) ?? quoted)
  if (!described?.text) return null
  return described.text.length > 220 ? `${described.text.slice(0, 220)}…` : described.text
}

function mentionsUser(content: WAMessageContent, meJid: string | null): boolean {
  if (!meJid) return false
  const contextInfo =
    content.extendedTextMessage?.contextInfo ??
    content.imageMessage?.contextInfo ??
    content.videoMessage?.contextInfo ??
    null
  const mentioned = contextInfo?.mentionedJid ?? []
  const meUser = meJid.split('@')[0]
  return mentioned.some((jid) => jid.split('@')[0] === meUser)
}

export function toIncomingMessage(
  waMessage: WAMessage,
  options: { meJid: string | null; chatName?: string | null },
): IncomingMessage | null {
  const chatJid = waMessage.key.remoteJid
  const messageId = waMessage.key.id
  if (!chatJid || !messageId) return null
  if (chatJid === 'status@broadcast' || chatJid.endsWith('@newsletter')) return null

  const content = unwrap(waMessage.message)
  if (!content) return null

  const described = describe(content)
  if (!described) return null

  const timestamp = Number(waMessage.messageTimestamp ?? 0)
  if (!timestamp) return null

  const isGroup = chatJid.endsWith('@g.us')
  const senderJid = waMessage.key.fromMe
    ? options.meJid
    : isGroup
      ? (waMessage.key.participant ?? null)
      : chatJid

  return {
    id: `${chatJid}:${messageId}`,
    chatJid,
    chatName: options.chatName ?? null,
    isGroup,
    senderJid: senderJid ? jidNormalizedUser(senderJid) : null,
    senderName: waMessage.key.fromMe ? 'Вы' : (waMessage.pushName ?? null),
    ts: timestamp,
    fromMe: Boolean(waMessage.key.fromMe),
    kind: described.kind,
    text: described.text,
    quotedText: quotedText(content),
    mentionsMe: mentionsUser(content, options.meJid),
  }
}
