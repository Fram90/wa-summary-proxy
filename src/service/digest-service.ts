import { logger } from '../logger.js'
import { listChats, markDigestDelivered } from '../db/repo.js'
import { buildDigest, type DigestRunReport, type DigestTrigger } from '../summarize/index.js'
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

  async runForChat(options: {
    chatJid: string
    hours: number
    trigger: DigestTrigger
    force?: boolean
  }): Promise<DigestRunReport> {
    return this.enqueue(async () => {
      const to = Math.floor(Date.now() / 1000)
      const from = to - options.hours * 3600
      const outcome = await buildDigest({
        chatJid: options.chatJid,
        from,
        to,
        trigger: options.trigger,
        force: options.force,
      })

      if ('skip' in outcome) {
        return { digests: [], skipped: [outcome.skip] }
      }

      const digest = outcome.digest
      const worthSending = digest.model !== 'none' || digest.photos.length > 0
      if (this.notifier.enabled && worthSending) {
        try {
          await this.notifier.sendDigest(digest)
          markDigestDelivered(digest.id)
        } catch (error) {
          const message = (error as Error).message
          markDigestDelivered(digest.id, message)
          logger.error({ err: error, digestId: digest.id }, 'дайджест собран, но не доставлен в Telegram')
        }
      }

      return { digests: [digest], skipped: [] }
    })
  }

  async runForTrackedChats(options: { hours: number; trigger: DigestTrigger }): Promise<DigestRunReport> {
    const chats = listChats({ onlyTracked: true })
    if (chats.length === 0) {
      logger.warn('нет ни одного отслеживаемого чата — дайджест собирать не из чего')
      return { digests: [], skipped: [] }
    }

    const report: DigestRunReport = { digests: [], skipped: [] }
    for (const chat of chats) {
      const part = await this.runForChat({ chatJid: chat.jid, hours: options.hours, trigger: options.trigger })
      report.digests.push(...part.digests)
      report.skipped.push(...part.skipped)
    }
    return report
  }
}
