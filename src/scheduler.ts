import cron, { type ScheduledTask } from 'node-cron'
import { logger } from './logger.js'
import { deleteMessagesOlderThan } from './db/repo.js'
import { getSettings, settingsEvents } from './settings.js'
import type { DigestService } from './service/digest-service.js'

const CLEANUP_CRON = '17 4 * * *'

export class Scheduler {
  private digestTask: ScheduledTask | null = null
  private cleanupTask: ScheduledTask | null = null

  constructor(private readonly service: DigestService) {}

  start() {
    this.reschedule()
    settingsEvents.on('change', () => this.reschedule())
  }

  nextRunAt(): Date | null {
    return this.digestTask?.getNextRun() ?? null
  }

  private reschedule() {
    const settings = getSettings()

    void this.digestTask?.destroy()
    this.digestTask = null

    if (!cron.validate(settings.digestCron)) {
      logger.error({ cron: settings.digestCron }, 'некорректное cron-выражение, плановые дайджесты выключены')
      return
    }

    this.digestTask = cron.schedule(
      settings.digestCron,
      async () => {
        logger.info('плановый дайджест: старт')
        try {
          const digests = await this.service.runForTrackedChats({
            hours: getSettings().digestWindowHours,
            trigger: 'schedule',
          })
          logger.info({ count: digests.length }, 'плановый дайджест: готово')
        } catch (error) {
          logger.error({ err: error }, 'плановый дайджест не собрался')
        }
      },
      { timezone: settings.timezone, noOverlap: true, name: 'digest' },
    )

    if (!this.cleanupTask) {
      this.cleanupTask = cron.schedule(
        CLEANUP_CRON,
        () => {
          const cutoff = Math.floor(Date.now() / 1000) - getSettings().retentionDays * 86_400
          const removed = deleteMessagesOlderThan(cutoff)
          if (removed > 0) logger.info({ removed }, 'удалены сообщения старше срока хранения')
        },
        { timezone: settings.timezone, name: 'cleanup' },
      )
    }

    logger.info(
      { cron: settings.digestCron, timezone: settings.timezone, nextRun: this.nextRunAt()?.toISOString() },
      'расписание дайджестов обновлено',
    )
  }

  async stop() {
    await this.digestTask?.destroy()
    await this.cleanupTask?.destroy()
  }
}
