import { EventEmitter } from 'node:events'
import QRCode from 'qrcode'
import { logger } from '../logger.js'
import { type IncomingMessage, saveMessages, setChatTracked, stats, upsertChat } from '../db/repo.js'
import type { SessionState, WhatsappGateway } from './types.js'

const DEMO_CHAT = '79001234567-1600000000@g.us'
const DEMO_CHAT_NAME = 'Ремонт в Черёмушках'
const DEMO_DM = '79005550101@s.whatsapp.net'

interface SeedLine {
  minutesAgo: number
  author: string
  text: string
  kind?: string
  quoted?: string
  mentionsMe?: boolean
}

/** Правдоподобный оживлённый рабочий чат — чтобы на демо было что суммировать. */
const seedLines: SeedLine[] = [
  { minutesAgo: 700, author: 'Марина (дизайнер)', text: 'Доброе утро! Отправила в чат финальную раскладку плитки в санузле, посмотрите пожалуйста' },
  { minutesAgo: 698, author: 'Марина (дизайнер)', text: '[файл: sanuzel-plitka-v4.pdf]', kind: 'document' },
  { minutesAgo: 690, author: 'Игорь (прораб)', text: 'Принял. По плитке вопрос: затирка светлая или тёмная? От этого зависит закупка' },
  { minutesAgo: 688, author: 'Марина (дизайнер)', text: 'Светлая, тон 03. Тёмная будет спорить с фасадами' },
  { minutesAgo: 685, author: 'Игорь (прораб)', text: 'Ок, беру 03. Ещё: электрик просит окончательные точки под подсветку зеркала' },
  { minutesAgo: 660, author: 'Сергей (сосед)', text: 'Коллеги, шумные работы после 19:00 не начинайте, у нас малыш засыпает' },
  { minutesAgo: 655, author: 'Игорь (прораб)', text: 'Сергей, штробить закончим до 18:00, дальше только тихие работы' },
  { minutesAgo: 640, author: 'Марина (дизайнер)', text: 'По подсветке зеркала: две точки, на высоте 1900 от пола, симметрично', mentionsMe: true },
  { minutesAgo: 600, author: 'Игорь (прораб)', text: '[фото]', kind: 'image' },
  { minutesAgo: 598, author: 'Игорь (прораб)', text: 'Вот так сейчас выглядит стена под шкаф. Есть отклонение 2 см по вертикали, будем выравнивать' },
  { minutesAgo: 590, author: 'Аня', text: 'А это повлияет на сроки?' },
  { minutesAgo: 585, author: 'Игорь (прораб)', text: 'Плюс один день. Сдвигаемся с 24-го на 25-е по этой комнате' },
  { minutesAgo: 540, author: 'Марина (дизайнер)', text: 'Важно: кухню на замер вызывать только после выравнивания стен, иначе всё переделывать' },
  { minutesAgo: 500, author: 'Аня', text: 'Записала. Замер кухни двигаем на 26-е' },
  { minutesAgo: 480, author: 'Игорь (прораб)', text: 'Нужна оплата за материалы: плитка + затирка + клей = 84 500 ₽. Скину реквизиты', mentionsMe: true },
  { minutesAgo: 478, author: 'Игорь (прораб)', text: '[файл: smeta-materialy-fevral.xlsx]', kind: 'document' },
  { minutesAgo: 450, author: 'Аня', text: 'А в смете учтён запас на подрезку? В прошлый раз не хватило' },
  { minutesAgo: 448, author: 'Игорь (прораб)', text: 'Да, 10% запас заложен' },
  { minutesAgo: 400, author: 'Сергей (сосед)', text: 'Ещё раз про лифт: грузовой бронируйте у консьержа, иначе штраф от УК' },
  { minutesAgo: 395, author: 'Игорь (прораб)', text: 'Забронировал на четверг с 10 до 13' },
  { minutesAgo: 380, author: 'Марина (дизайнер)', text: '[голосовое 1:24]', kind: 'voice' },
  { minutesAgo: 350, author: 'Марина (дизайнер)', text: 'Кратко из голосового: светильники в коридоре меняем на модель с диммером, разница по цене 6 тысяч' },
  { minutesAgo: 300, author: 'Аня', text: 'Согласна на диммер' },
  { minutesAgo: 260, author: 'Игорь (прораб)', text: 'Тогда электрику нужен ещё один провод в коридор, сделаем завтра до штукатурки' },
  { minutesAgo: 240, author: 'Вы', text: 'Оплату по материалам сделаю сегодня вечером' },
  { minutesAgo: 200, author: 'Игорь (прораб)', text: 'Отлично. И ещё: нужно решить по двери в санузел, ширина 70 или 80?', quoted: 'Оплату по материалам сделаю сегодня вечером', mentionsMe: true },
  { minutesAgo: 180, author: 'Марина (дизайнер)', text: '80, иначе стиральная машина не пройдёт при монтаже' },
  { minutesAgo: 150, author: 'Аня', text: 'Плюсую за 80' },
  { minutesAgo: 120, author: 'Игорь (прораб)', text: 'Принято, заказываю 80. Дедлайн по заказу двери — завтра до обеда' },
  { minutesAgo: 90, author: 'Сергей (сосед)', text: 'У вас вода на площадке натекла из-под двери, посмотрите' },
  { minutesAgo: 85, author: 'Игорь (прораб)', text: 'Уже вытерли, это от промывки инструмента. Поставили поддон' },
  { minutesAgo: 60, author: 'Марина (дизайнер)', text: 'Напоминаю: в пятницу в 12:00 встреча на объекте, нужен кто-то из вас', mentionsMe: true },
  { minutesAgo: 45, author: 'Аня', text: 'Я не смогу, буду в поездке' },
  { minutesAgo: 30, author: 'Игорь (прораб)', text: 'Тогда ждём хозяина. Список вопросов пришлю к вечеру четверга' },
  { minutesAgo: 15, author: 'Марина (дизайнер)', text: 'И последнее: подтвердите, что цвет фасадов остаётся RAL 7044, поставщик ждёт до понедельника', mentionsMe: true },
]

const dmLines: SeedLine[] = [
  { minutesAgo: 320, author: 'Мама', text: 'Позвони, когда сможешь' },
  { minutesAgo: 100, author: 'Мама', text: 'Не забудь про воскресенье' },
]

export class DemoGateway implements WhatsappGateway {
  readonly events = new EventEmitter<{ state: [SessionState]; message: [void] }>()

  private state: SessionState = {
    status: 'need_pairing',
    demo: true,
    qr: null,
    me: null,
    connectedAt: null,
    lastDisconnectAt: null,
    lastError: null,
    reconnectAttempts: 0,
    historySync: { chats: 0, messages: 0, isLatest: false, progress: null, updatedAt: null },
  }

  getState(): SessionState {
    return { ...this.state, historySync: { ...this.state.historySync } }
  }

  private patchState(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch }
    this.events.emit('state', this.getState())
  }

  async start(): Promise<void> {
    const dataUrl = await QRCode.toDataURL('DEMO-QR-НЕ-НАСТОЯЩАЯ-ПРИВЯЗКА', { margin: 1, width: 512 })
    this.patchState({ qr: { dataUrl, expiresAt: Date.now() + 3_600_000 } })

    // Если данные уже посеяны (перезапуск dev-сервера), сразу показываем подключённое состояние.
    if (stats().messages > 0) await this.connect()
    logger.warn('DEMO_MODE включён: WhatsApp не подключается, работаем на посеянных данных')
  }

  /** Имитирует успешную привязку устройства и наполняет базу примером переписки. */
  async connect(): Promise<void> {
    this.seed()
    this.patchState({
      status: 'open',
      qr: null,
      connectedAt: Date.now(),
      me: { id: '79001112233@s.whatsapp.net', name: 'Демо-аккаунт' },
      historySync: { chats: 2, messages: seedLines.length + dmLines.length, isLatest: true, progress: 100, updatedAt: Date.now() },
    })
  }

  private seed() {
    if (stats().messages > 0) return

    const nowSeconds = Math.floor(Date.now() / 1000)
    const build = (lines: SeedLine[], chatJid: string, chatName: string, isGroup: boolean): IncomingMessage[] =>
      lines.map((line, index) => ({
        id: `${chatJid}:demo-${index}`,
        chatJid,
        chatName,
        isGroup,
        senderJid: line.author === 'Вы' ? '79001112233@s.whatsapp.net' : `demo-${line.author}`,
        senderName: line.author,
        ts: nowSeconds - line.minutesAgo * 60,
        fromMe: line.author === 'Вы',
        kind: line.kind ?? 'text',
        text: line.text,
        quotedText: line.quoted ?? null,
        mentionsMe: Boolean(line.mentionsMe),
      }))

    upsertChat({ jid: DEMO_CHAT, name: DEMO_CHAT_NAME, isGroup: true })
    upsertChat({ jid: DEMO_DM, name: 'Мама', isGroup: false })
    saveMessages([
      ...build(seedLines, DEMO_CHAT, DEMO_CHAT_NAME, true),
      ...build(dmLines, DEMO_DM, 'Мама', false),
    ])
    setChatTracked(DEMO_CHAT, true)
    logger.info('посеяны демо-данные')
  }

  async stop(): Promise<void> {}

  async reset(): Promise<void> {
    this.patchState({ status: 'need_pairing', me: null, connectedAt: null })
    await this.start()
  }

  async backfill(): Promise<{ requested: number }> {
    throw new Error('в демо-режиме догрузка истории недоступна')
  }
}
