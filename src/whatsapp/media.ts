import { downloadMediaMessage, type WAMessage, type WAMessageContent, type WASocket } from '@whiskeysockets/baileys'
import { logger } from '../logger.js'

const MAX_FILE_BYTES = 8_000_000

interface ImageSnapshot {
  mimetype: string | null
  url: string | null
  directPath: string | null
  mediaKey: string | null
  fileEncSha256: string | null
  fileSha256: string | null
  fileLength: number | null
}

function toBase64(value: Uint8Array | null | undefined): string | null {
  if (!value || value.length === 0) return null
  return Buffer.from(value).toString('base64')
}

function fromBase64(value: string | null): Buffer | undefined {
  if (!value) return undefined
  return Buffer.from(value, 'base64')
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value && typeof value === 'object' && 'toString' in value) {
    const parsed = Number(String(value))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Ключи картинки, чтобы переслать её в Telegram. В модель снимок не уходит. */
export function snapshotImage(content: WAMessageContent): string | null {
  const image = content.imageMessage
  if (!image?.mediaKey) return null

  const fileLength = asNumber(image.fileLength)
  if (fileLength != null && fileLength > MAX_FILE_BYTES) return null

  const snapshot: ImageSnapshot = {
    mimetype: image.mimetype ?? null,
    url: image.url ?? null,
    directPath: image.directPath ?? null,
    mediaKey: toBase64(image.mediaKey),
    fileEncSha256: toBase64(image.fileEncSha256),
    fileSha256: toBase64(image.fileSha256),
    fileLength,
  }

  return JSON.stringify(snapshot)
}

export async function downloadImageSnapshot(
  socket: WASocket,
  chatJid: string,
  messageId: string,
  fromMe: boolean,
  mediaJson: string,
): Promise<{ buffer: Buffer; mimetype: string } | null> {
  let snapshot: ImageSnapshot
  try {
    snapshot = JSON.parse(mediaJson) as ImageSnapshot
  } catch {
    return null
  }

  if (!snapshot.mediaKey) return null

  const waMessage = {
    key: {
      remoteJid: chatJid,
      id: messageId,
      fromMe,
    },
    message: {
      imageMessage: {
        url: snapshot.url,
        directPath: snapshot.directPath,
        mimetype: snapshot.mimetype,
        mediaKey: fromBase64(snapshot.mediaKey),
        fileEncSha256: fromBase64(snapshot.fileEncSha256),
        fileSha256: fromBase64(snapshot.fileSha256),
        fileLength: snapshot.fileLength,
      },
    },
  } as WAMessage

  try {
    const buffer = await downloadMediaMessage(waMessage, 'buffer', {}, {
      logger: logger.child({ module: 'media' }),
      reuploadRequest: (message) => socket.updateMediaMessage(message),
    })
    if (!buffer.length || buffer.length > MAX_FILE_BYTES) return null
    return { buffer, mimetype: snapshot.mimetype ?? 'image/jpeg' }
  } catch (error) {
    logger.warn({ err: error, messageId }, 'не удалось скачать фото для дайджеста')
    return null
  }
}
