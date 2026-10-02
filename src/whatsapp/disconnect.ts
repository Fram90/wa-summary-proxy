import type { Boom } from '@hapi/boom'
import { DisconnectReason } from '@whiskeysockets/baileys'

export function disconnectCode(error: Error | undefined): number | undefined {
  return (error as Boom | undefined)?.output?.statusCode
}

/** Человеческое описание кода, с которым WhatsApp закрыл сокет. */
export function describeDisconnect(statusCode: number | undefined, message: string | undefined): string {
  switch (statusCode) {
    case DisconnectReason.connectionClosed:
      return 'WhatsApp закрыл соединение до выдачи QR (код 428). Так бывает, когда клиент представляется как Desktop — сервер это отклоняет. Нужен профиль Chrome, не Desktop.'
    case DisconnectReason.loggedOut:
      return 'Устройство отвязано в WhatsApp. Нужен новый QR.'
    case DisconnectReason.timedOut:
    case DisconnectReason.connectionLost:
      return 'Таймаут соединения с WhatsApp (код 408). Если это случилось сразу после сканирования QR, версия WhatsApp Web на сервере, скорее всего, устарела.'
    case DisconnectReason.forbidden:
      return 'WhatsApp отклонил этот IP (код 403). Датацентры иногда банят исходящие подключения к WhatsApp.'
    case DisconnectReason.restartRequired:
      return 'WhatsApp просит перезапустить сессию (код 515). Обычно это нормально сразу после привязки.'
    case DisconnectReason.badSession:
      return 'Сессия повреждена (код 500). Нажмите «Привязать заново» и отсканируйте новый QR.'
    case DisconnectReason.multideviceMismatch:
      return 'Несовпадение режима multi-device (код 411). На телефоне должен быть включён WhatsApp с несколькими устройствами.'
    case DisconnectReason.connectionReplaced:
      return 'Сессию перехватило другое связанное устройство (код 440).'
    case DisconnectReason.unavailableService:
      return 'WhatsApp временно недоступен (код 503). Подождите и попробуйте снова.'
    default:
      break
  }

  const parts = [message?.trim() || 'Соединение закрыто']
  if (statusCode) parts.push(`код ${statusCode}`)
  return parts.join(' · ')
}
