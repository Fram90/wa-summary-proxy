import { config } from './config.js'
import { logger } from './logger.js'
import './db/index.js'
import { Scheduler } from './scheduler.js'
import { DigestService } from './service/digest-service.js'
import { TelegramNotifier } from './telegram/bot.js'
import { createServer } from './http/server.js'
import { BaileysGateway } from './whatsapp/client.js'
import { DemoGateway } from './whatsapp/demo.js'
import type { WhatsappGateway } from './whatsapp/types.js'

async function main() {
  const gateway: WhatsappGateway = config.DEMO_MODE ? new DemoGateway() : new BaileysGateway()
  const notifier = new TelegramNotifier()
  const service = new DigestService(notifier)
  const scheduler = new Scheduler(service)

  notifier.attach({ gateway, runner: service })

  let lastStatus = gateway.getState().status
  gateway.events.on('state', (state) => {
    if (state.status === lastStatus) return
    lastStatus = state.status

    if (state.status === 'logged_out') {
      void notifier.sendAlert('WhatsApp отвязал устройство. Откройте панель и привяжите заново по QR — дайджестов пока не будет.')
    }
    if (state.status === 'need_pairing') {
      logger.warn('ждём привязки устройства: откройте панель или отсканируйте QR из консоли')
    }
  })

  await notifier.start()
  scheduler.start()

  const server = await createServer({ gateway, service, scheduler, notifier })
  await server.listen({ host: config.HOST, port: config.PORT })
  logger.info(`панель доступна на http://127.0.0.1:${config.PORT}`)

  try {
    await gateway.start()
  } catch (error) {
    logger.error({ err: error }, 'не удалось подключиться к WhatsApp')
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'останавливаюсь')
    await scheduler.stop()
    await notifier.stop()
    await gateway.stop()
    await server.close()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error) => {
  logger.fatal({ err: error }, 'приложение не запустилось')
  process.exit(1)
})
