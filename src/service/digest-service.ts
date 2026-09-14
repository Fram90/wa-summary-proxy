import { logger } from '../logger.js'
import { listChats, markDigestDelivered } from '../db/repo.js'
import { buildDigest, type DigestResult, type DigestTrigger } from '../summarize/index.js'
import type { TelegramNotifier } from '../telegram/bot.js'

export class DigestService {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly notifier: TelegramNotifier) {}

  /** Сборка дайджестов идёт по одному: и модель, и Telegram не любят параллельных наскоков. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task)
    this.queue = result.catch(() => undefined)
    return result
  }

  async runForChat(options: { chatJid: string; hours: number; trigger: DigestTrigger }): Promise<DigestResult | null> {
    return this.enqueue(async () => {
      const to = Math.floor(Date.now() / 1000)
      const from = to - options.hours * 3600

      const digest = await buildDigest({ chatJid: options.chatJid, from, to, trigger: options.trigger })
      if (!digest) return null

      if (this.notifier.enabled) {
        try {
          await this.notifier.sendDigest(digest)
          markDigestDelivered(digest.id)
        } catch (error) {
          const message = (error as Error).message
          markDigestDelivered(digest.id, message)
          logger.error({ err: error, digestId: digest.id }, 'дайджест собран, но не доставлен в Telegram')
        }
      }

      return digest
    })
  }

  async runForTrackedChats(options: { hours: number; trigger: DigestTrigger }): Promise<DigestResult[]> {
    const chats = listChats({ onlyTracked: true })
    if (chats.length === 0) {
      logger.warn('нет ни одного отслеживаемого чата — дайджест собирать не из чего')
      return []
    }

    const results: DigestResult[] = []
    for (const chat of chats) {
      const digest = await this.runForChat({ chatJid: chat.jid, hours: options.hours, trigger: options.trigger })
      if (digest) results.push(digest)
    }
    return results
  }
}
