import { useState } from 'react'
import { AlertTriangle, Loader2, LogOut, Smartphone, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { countWithNoun, formatUntil } from '@/lib/format'
import type { AppState } from '@/lib/types'
import { StatusPill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'

const pairingSteps = [
  'Откройте WhatsApp на телефоне',
  'Настройки → Связанные устройства',
  'Нажмите «Привязка устройства»',
  'Наведите камеру на QR-код',
]

export function ConnectionView({ state, onRefresh }: { state: AppState; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState<'reset' | 'demo' | null>(null)
  const { session } = state
  const showPairing = session.status !== 'open' && !session.me

  const run = async (kind: 'reset' | 'demo', action: () => Promise<unknown>, successText: string) => {
    setBusy(kind)
    try {
      await action()
      toast.success(successText)
      await onRefresh()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Связанное устройство</CardTitle>
              <CardDescription>
                Приложение подключается к WhatsApp так же, как WhatsApp Web: читает переписку от вашего имени, ничего не
                отправляет.
              </CardDescription>
            </div>
            <StatusPill status={session.status} />
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {showPairing ? (
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
              <div className="mx-auto shrink-0 rounded-xl border bg-white p-3 shadow-sm sm:mx-0">
                {session.qr ? (
                  <img
                    src={session.qr.dataUrl}
                    alt="QR-код для привязки устройства"
                    className="size-52 sm:size-56"
                    width={224}
                    height={224}
                  />
                ) : (
                  <div className="flex size-52 items-center justify-center text-center text-sm text-neutral-500 sm:size-56">
                    {session.status === 'reconnecting' ? (
                      <span>
                        WhatsApp рвёт соединение до QR.
                        <br />
                        Переподключаюсь…
                      </span>
                    ) : (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        Генерирую QR…
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <ol className="space-y-2 text-sm">
                  {pairingSteps.map((step, index) => (
                    <li key={step} className="flex gap-3">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                        {index + 1}
                      </span>
                      <span className="pt-0.5">{step}</span>
                    </li>
                  ))}
                </ol>
                <p className="text-xs text-muted-foreground">
                  QR обновляется автоматически каждую минуту. Тот же код печатается в логах контейнера — можно
                  отсканировать прямо из ssh-сессии.
                </p>
                {state.demoMode && (
                  <Button
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() => void run('demo', api.demoConnect, 'Демо-подключение выполнено')}
                  >
                    {busy === 'demo' ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                    Симулировать подключение
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg border bg-secondary/40 p-4">
                <Smartphone className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {session.me?.name ?? session.me?.id ?? 'Аккаунт WhatsApp'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {session.connectedAt
                      ? `На связи с ${new Date(session.connectedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
                      : 'Соединение устанавливается'}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Metric label="Сообщений в базе" value={state.stats.messages.toLocaleString('ru-RU')} />
                <Metric label="Чатов найдено" value={state.stats.chats.toLocaleString('ru-RU')} />
                <Metric label="Под наблюдением" value={state.stats.trackedChats.toLocaleString('ru-RU')} />
              </div>

              {session.historySync.updatedAt && (
                <p className="text-xs text-muted-foreground">
                  Синхронизация истории: получено {countWithNoun(session.historySync.messages, 'сообщение', 'сообщения', 'сообщений')} из{' '}
                  {countWithNoun(session.historySync.chats, 'чата', 'чатов', 'чатов')}
                  {session.historySync.isLatest ? ', синхронизация завершена' : ', порции ещё приходят'}.
                </p>
              )}
            </div>
          )}

          {session.lastError && (
            <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-medium">Последняя ошибка соединения</p>
                <p className="text-muted-foreground">{session.lastError}</p>
                {session.lastDisconnectCode != null && (
                  <p className="text-xs text-muted-foreground">Код закрытия: {session.lastDisconnectCode}</p>
                )}
                {session.reconnectAttempts > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Попыток переподключения: {session.reconnectAttempts}. Подробности: docker compose logs --tail=80
                  </p>
                )}
              </div>
            </div>
          )}

          <Separator />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Отвязка удалит ключи сессии на сервере. Сохранённые сообщения и дайджесты останутся.
            </p>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={busy !== null}>
                  <LogOut className="size-4" />
                  Привязать заново
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Отвязать устройство?</DialogTitle>
                  <DialogDescription>
                    Текущая сессия WhatsApp будет удалена, приложение покажет новый QR-код. Понадобится телефон.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="ghost">Отмена</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button
                      variant="destructive"
                      onClick={() => void run('reset', api.resetSession, 'Сессия сброшена, сканируйте новый QR')}
                    >
                      Отвязать
                    </Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Что происходит дальше</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              После привязки WhatsApp пришлёт историю переписки — обычно за последние месяцы. Дальше сообщения приходят
              в реальном времени, даже когда телефон выключен.
            </p>
            <p>
              Прочтения не отправляются, статус «онлайн» не выставляется: чаты у вас останутся непрочитанными, пуши на
              телефон продолжат приходить.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Проверка окружения</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <CheckRow
              ok={state.llm.enabled}
              okText={`Модель ${state.llm.model}`}
              failText="Не задан OPENAI_API_KEY — summary собираться не будет"
            />
            <CheckRow
              ok={state.telegram.enabled}
              okText={
                state.telegram.chatId
                  ? `Telegram подключён, получатель ${state.telegram.chatId}`
                  : 'Telegram подключён, напишите боту /start'
              }
              failText="Не задан TELEGRAM_BOT_TOKEN — дайджесты будут только здесь"
            />
            <CheckRow
              ok={state.authRequired}
              okText="Панель защищена токеном"
              failText="DASHBOARD_TOKEN не задан — не открывайте панель в интернет"
            />
            <p className="pt-1 text-xs text-muted-foreground">
              Провайдер модели: <code className="rounded bg-secondary px-1 py-0.5">{state.llm.baseUrl}</code>
            </p>
            {state.nextRunAt && (
              <p className="text-xs text-muted-foreground">
                Следующий плановый дайджест {formatUntil(Math.floor(new Date(state.nextRunAt).getTime() / 1000))}
                {' — '}
                {new Date(state.nextRunAt).toLocaleString('ru-RU')}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function CheckRow({ ok, okText, failText }: { ok: boolean; okText: string; failText: string }) {
  return (
    <div className="flex items-start gap-2">
      <span
        className={`mt-1.5 size-2 shrink-0 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`}
        aria-hidden
      />
      <span className={ok ? '' : 'text-muted-foreground'}>{ok ? okText : failText}</span>
    </div>
  )
}
