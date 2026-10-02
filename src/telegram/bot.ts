import { Bot, InlineKeyboard, InputFile } from 'grammy'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { getChat, listChats, setChatTracked, stats } from '../db/repo.js'
import { getSettings, updateSettings } from '../settings.js'
import type { DigestResult, DigestRunReport } from '../summarize/index.js'
import { formatPeriod } from '../summarize/transcript.js'
import type { WhatsappGateway } from '../whatsapp/types.js'
import { markdownToTelegramHtml, splitMessage } from './format.js'

export interface DigestRunner {
  runForTrackedChats(options: { hours: number; trigger: 'telegram' | 'manual' }): Promise<DigestRunReport>
}

const statusLabels: Record<string, string> = {
  starting: 'запускается',
  need_pairing: 'ждёт привязки по QR',
  connecting: 'подключается',
  open: 'подключён',
  reconnecting: 'переподключается',
  logged_out: 'устройство отвязано, нужен новый QR',
  error: 'ошибка',
}

export class TelegramNotifier {
  private bot: Bot | null = null
  private gateway: WhatsappGateway | null = null
  private runner: DigestRunner | null = null

  get enabled(): boolean {
    return this.bot !== null
  }

  attach(dependencies: { gateway: WhatsappGateway; runner: DigestRunner }) {
    this.gateway = dependencies.gateway
    this.runner = dependencies.runner
  }

  private get chatId(): string | null {
    return getSettings().telegramChatId
  }

  private ownerId(): string | null {
    return getSettings().telegramOwnerId
  }

  async start(): Promise<void> {
    if (!config.TELEGRAM_BOT_TOKEN) {
      logger.warn('TELEGRAM_BOT_TOKEN не задан: дайджесты будут только в панели')
      return
    }

    const bot = new Bot(config.TELEGRAM_BOT_TOKEN)
    this.bot = bot

    bot.use(async (ctx, next) => {
      const incomingChatId = ctx.chat?.id?.toString()
      const userId = ctx.from?.id?.toString()
      if (!incomingChatId || !userId) return

      const ownerId = this.ownerId()
      const isPrivate = ctx.chat?.type === 'private'

      // Владельцем становится тот, кто первым написал в личку. Группа сама по себе доступ не открывает.
      if (!ownerId) {
        if (!isPrivate) {
          if (ctx.message?.text?.startsWith('/')) {
            await ctx.reply('Сначала напишите боту /start в личные сообщения — так он запомнит владельца.')
          }
          return
        }
        updateSettings({ telegramOwnerId: userId, telegramChatId: this.chatId ?? incomingChatId })
        logger.info({ userId, chatId: incomingChatId }, 'владелец Telegram-бота сохранён')
        await next()
        return
      }

      if (userId !== ownerId) {
        if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'Команды доступны только владельцу бота' })
        else if (isPrivate) await ctx.reply('Этот бот приватный и обслуживает только своего владельца.')
        return
      }

      await next()
    })

    bot.command('start', async (ctx) => {
      const settings = getSettings()
      const here = settings.telegramChatId === ctx.chat.id.toString()
      await ctx.reply(
        [
          'Привет. Я приношу выжимки из ваших чатов WhatsApp.',
          '',
          here
            ? 'Дайджесты приходят в этот чат.'
            : `Дайджесты приходят в чат <code>${settings.telegramChatId ?? 'не задан'}</code>.`,
          'Чтобы публиковать их в группу, добавьте бота в неё и напишите там /here.',
          'Вернуть доставку в личку: /dm',
          '',
          'Команды:',
          '/summary [часы] — выжимка за последние N часов (по умолчанию из настроек)',
          '/chats — выбрать, за какими чатами следить',
          '/status — состояние подключения к WhatsApp',
          '/window N — сколько часов брать в плановый дайджест',
          '/settings — текущие настройки',
        ].join('\n'),
        { parse_mode: 'HTML' },
      )
    })

    bot.command('here', async (ctx) => {
      if (ctx.chat.type === 'private') {
        await ctx.reply('Эту команду нужно отправить в группе, куда вы добавили бота.')
        return
      }
      updateSettings({ telegramChatId: ctx.chat.id.toString() })
      await ctx.reply('Дайджесты будут публиковаться в этом чате. Команды по-прежнему слушаю только у вас.')
    })

    bot.command('dm', async (ctx) => {
      const ownerId = this.ownerId()
      if (!ownerId) return
      updateSettings({ telegramChatId: ownerId })
      await ctx.reply('Дайджесты снова приходят в личные сообщения.')
    })

    bot.command('help', (ctx) =>
      ctx.reply(
        [
          '/summary [часы] — выжимка по отслеживаемым чатам',
          '/chats — включить или выключить слежение за чатом',
          '/here — публиковать дайджесты в этот групповой чат',
          '/dm — снова присылать дайджесты в личку',
          '/status — состояние сессии WhatsApp и статистика',
          '/window N — окно планового дайджеста в часах',
          '/settings — расписание, модель, таймзона',
        ].join('\n'),
      ),
    )

    bot.command('status', async (ctx) => {
      const state = this.gateway?.getState()
      const counters = stats()
      const settings = getSettings()
      const status = state ? (statusLabels[state.status] ?? state.status) : 'неизвестно'

      await ctx.reply(
        [
          `<b>WhatsApp:</b> ${status}${state?.demo ? ' (демо-режим)' : ''}`,
          state?.me ? `<b>Аккаунт:</b> ${state.me.name ?? state.me.id}` : null,
          state?.lastError ? `<b>Последняя ошибка:</b> ${state.lastError}` : null,
          '',
          `<b>Чатов:</b> ${counters.chats}, из них отслеживается ${counters.trackedChats}`,
          `<b>Сообщений в базе:</b> ${counters.messages}`,
          `<b>Дайджестов:</b> ${counters.digests}`,
          '',
          `<b>Расписание:</b> ${settings.digestCron} (${settings.timezone})`,
          `<b>Окно дайджеста:</b> ${settings.digestWindowHours} ч`,
          `<b>Модель:</b> ${settings.llmModel}`,
          '',
          `<b>Куда слать дайджесты:</b> <code>${settings.telegramChatId ?? 'не задан'}</code>`,
        ]
          .filter(Boolean)
          .join('\n'),
        { parse_mode: 'HTML' },
      )
    })

    bot.command('settings', async (ctx) => {
      const settings = getSettings()
      await ctx.reply(
        [
          `<b>Расписание:</b> ${settings.digestCron}`,
          `<b>Таймзона:</b> ${settings.timezone}`,
          `<b>Окно:</b> ${settings.digestWindowHours} ч`,
          `<b>Модель:</b> ${settings.llmModel}`,
          `<b>Хранить сообщения:</b> ${settings.retentionDays} дней`,
          `<b>Куда слать:</b> <code>${settings.telegramChatId ?? 'не задан'}</code>`,
          '',
          'Группа: добавьте бота и напишите там /here. Обратно в личку: /dm.',
        ].join('\n'),
        { parse_mode: 'HTML' },
      )
    })

    bot.command('window', async (ctx) => {
      const hours = Number.parseInt(ctx.match.trim(), 10)
      if (!Number.isFinite(hours) || hours < 1 || hours > 336) {
        await ctx.reply('Укажите число часов от 1 до 336, например: /window 12')
        return
      }
      updateSettings({ digestWindowHours: hours })
      await ctx.reply(`Окно планового дайджеста теперь ${hours} ч.`)
    })

    bot.command('chats', async (ctx) => {
      const chats = listChats().slice(0, 12)
      if (chats.length === 0) {
        await ctx.reply('Пока не вижу ни одного чата. Дождитесь синхронизации после привязки устройства.')
        return
      }

      const keyboard = new InlineKeyboard()
      for (const chat of chats) {
        const mark = chat.tracked ? '✅' : '▫️'
        const name = chat.name ?? chat.jid.split('@')[0]
        keyboard.text(`${mark} ${name?.slice(0, 40)} (${chat.message_count})`, `track:${chat.jid}`).row()
      }

      await ctx.reply('За какими чатами следить? Нажмите, чтобы переключить:', { reply_markup: keyboard })
    })

    bot.callbackQuery(/^track:(.+)$/, async (ctx) => {
      const jid = ctx.match[1]
      if (!jid) return
      const chat = getChat(jid)
      if (!chat) {
        await ctx.answerCallbackQuery('Чат не найден')
        return
      }

      const next = chat.tracked === 0
      setChatTracked(jid, next)
      await ctx.answerCallbackQuery(next ? 'Следим за чатом' : 'Больше не следим')

      const chats = listChats().slice(0, 12)
      const keyboard = new InlineKeyboard()
      for (const item of chats) {
        const mark = item.tracked ? '✅' : '▫️'
        const name = item.name ?? item.jid.split('@')[0]
        keyboard.text(`${mark} ${name?.slice(0, 40)} (${item.message_count})`, `track:${item.jid}`).row()
      }
      await ctx.editMessageReplyMarkup({ reply_markup: keyboard })
    })

    bot.command('summary', async (ctx) => {
      if (!this.runner) return
      const requested = Number.parseInt(ctx.match.trim(), 10)
      const hours = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 336) : getSettings().digestWindowHours

      await ctx.reply(`Собираю выжимку за последние ${hours} ч, это займёт до минуты…`)
      try {
        const report = await this.runner.runForTrackedChats({ hours, trigger: 'telegram' })
        if (report.digests.length === 0) {
          const onlySeen = report.skipped.length > 0 && report.skipped.every((item) => item.reason === 'no_new')
          await ctx.reply(
            onlySeen
              ? 'С прошлого дайджеста новых сообщений нет — модель не вызывал.'
              : 'Новых сообщений за этот период нет — либо ни один чат не отмечен как отслеживаемый. Посмотрите /chats.',
          )
        }
      } catch (error) {
        logger.error({ err: error }, 'не удалось собрать дайджест по команде')
        await ctx.reply(`Не получилось: ${(error as Error).message}`)
      }
    })

    bot.catch((error) => {
      logger.error({ err: error.error }, 'ошибка в Telegram-боте')
    })

    await bot.api.setMyCommands([
      { command: 'summary', description: 'Выжимка за последние N часов' },
      { command: 'chats', description: 'Выбрать отслеживаемые чаты' },
      { command: 'here', description: 'Публиковать дайджесты в этот чат' },
      { command: 'dm', description: 'Снова присылать дайджесты в личку' },
      { command: 'status', description: 'Состояние подключения' },
      { command: 'window', description: 'Окно планового дайджеста' },
      { command: 'settings', description: 'Текущие настройки' },
    ])

    void bot.start({
      onStart: (info) => logger.info({ username: info.username }, 'Telegram-бот запущен'),
    })
  }

  async stop(): Promise<void> {
    await this.bot?.stop()
  }

  private async sendRaw(text: string): Promise<void> {
    const chatId = this.chatId
    if (!this.bot) throw new Error('Telegram-бот не настроен')
    if (!chatId) throw new Error('Не задан TELEGRAM_CHAT_ID — напишите боту /start')

    for (const part of splitMessage(text)) {
      await this.bot.api.sendMessage(chatId, part, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      })
    }
  }

  async sendDigest(digest: DigestResult): Promise<void> {
    const settings = getSettings()
    const header = [
      `<b>📋 ${digest.chatName}</b>`,
      `<i>${formatPeriod(digest.periodStart, digest.periodEnd, settings.timezone)} · ${digest.messageCount} сообщений</i>`,
      '',
    ].join('\n')

    await this.sendRaw(header + markdownToTelegramHtml(digest.summaryMd))
    await this.forwardPhotos(digest)
  }

  /** Фото уходят как есть: модель их не видит и не описывает. */
  private async forwardPhotos(digest: DigestResult): Promise<void> {
    const chatId = this.chatId
    if (!this.bot || !chatId || !this.gateway || digest.photos.length === 0) return

    const timezone = getSettings().timezone
    for (const photo of digest.photos) {
      const file = await this.gateway.downloadImage(photo.chatJid, photo.messageId, photo.fromMe, photo.mediaJson)
      const when = new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: timezone,
      }).format(photo.ts * 1000)
      const who = photo.senderName ?? 'Участник'
      if (!file) {
        await this.sendRaw(`Не удалось переслать фото от ${who} (${when}).`)
        continue
      }

      const caption = [digest.chatName, who, when, photo.caption].filter(Boolean).join('\n').slice(0, 1000)
      await this.bot.api.sendPhoto(chatId, new InputFile(file.buffer, 'photo.jpg'), { caption })
    }
  }

  async sendAlert(text: string): Promise<void> {
    if (!this.bot || !this.chatId) return
    try {
      await this.sendRaw(`⚠️ ${text}`)
    } catch (error) {
      logger.warn({ err: error }, 'не удалось отправить уведомление в Telegram')
    }
  }
}
