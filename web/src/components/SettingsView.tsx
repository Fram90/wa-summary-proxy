import { useState } from 'react'
import { Loader2, Save, SendHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { describeCron } from '@/lib/format'
import type { AppState } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function SettingsView({ state, onChanged }: { state: AppState; onChanged: () => Promise<void> }) {
  const [form, setForm] = useState(state.settings)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const dirty = JSON.stringify(form) !== JSON.stringify(state.settings)

  const save = async () => {
    setSaving(true)
    try {
      await api.saveSettings({
        digestCron: form.digestCron,
        digestWindowHours: Number(form.digestWindowHours),
        timezone: form.timezone,
        llmModel: form.llmModel,
        retentionDays: Number(form.retentionDays),
        telegramChatId: form.telegramChatId?.trim() ? form.telegramChatId.trim() : null,
      })
      toast.success('Настройки сохранены, расписание перезапущено')
      await onChanged()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const testTelegram = async () => {
    setTesting(true)
    try {
      await api.testTelegram()
      toast.success('Отправил тестовое сообщение в Telegram')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Расписание</CardTitle>
          <CardDescription>Когда собирать и присылать дайджест по всем отслеживаемым чатам.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cron">Cron-выражение</Label>
            <Input
              id="cron"
              value={form.digestCron}
              onChange={(event) => setForm({ ...form, digestCron: event.target.value })}
              placeholder="0 9,21 * * *"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">{describeCron(form.digestCron)}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tz">Таймзона</Label>
              <Input
                id="tz"
                value={form.timezone}
                onChange={(event) => setForm({ ...form, timezone: event.target.value })}
                placeholder="Europe/Moscow"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="window">Окно, часов</Label>
              <Input
                id="window"
                type="number"
                min={1}
                max={336}
                value={form.digestWindowHours}
                onChange={(event) => setForm({ ...form, digestWindowHours: Number(event.target.value) })}
              />
            </div>
          </div>

          {state.nextRunAt && (
            <p className="text-xs text-muted-foreground">
              Следующий запуск: {new Date(state.nextRunAt).toLocaleString('ru-RU')}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Модель и хранение</CardTitle>
          <CardDescription>
            Провайдер задаётся переменной <code className="rounded bg-secondary px-1">OPENAI_BASE_URL</code> и меняется
            только через перезапуск.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="model">Модель</Label>
            <Input
              id="model"
              value={form.llmModel}
              onChange={(event) => setForm({ ...form, llmModel: event.target.value })}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">Текущий провайдер: {state.llm.baseUrl}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="retention">Хранить сообщения, дней</Label>
            <Input
              id="retention"
              type="number"
              min={1}
              max={3650}
              value={form.retentionDays}
              onChange={(event) => setForm({ ...form, retentionDays: Number(event.target.value) })}
            />
            <p className="text-xs text-muted-foreground">
              Раз в сутки всё, что старше, удаляется из базы на сервере.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Telegram</CardTitle>
          <CardDescription>
            {state.telegram.enabled
              ? 'Бот запущен. Получатель — один чат, обычно ваш личный диалог с ботом.'
              : 'Бот не настроен: задайте TELEGRAM_BOT_TOKEN в .env и перезапустите приложение.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="chat-id">Chat id получателя</Label>
            <Input
              id="chat-id"
              value={form.telegramChatId ?? ''}
              onChange={(event) => setForm({ ...form, telegramChatId: event.target.value })}
              placeholder="Заполнится сам после /start"
              className="font-mono"
            />
          </div>
          <Button variant="outline" disabled={!state.telegram.enabled || testing} onClick={() => void testTelegram()}>
            {testing ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
            Отправить тестовое сообщение
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Безопасность</CardTitle>
          <CardDescription>Что стоит держать в голове, раз приложение живёт на вашем сервере.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            В каталоге данных лежат ключи сессии WhatsApp. Кто получит доступ к серверу, получит доступ к переписке —
            держите панель за SSH-туннелем и обязательно задайте <code className="rounded bg-secondary px-1">DASHBOARD_TOKEN</code>.
          </p>
          <p>
            Текст сообщений уходит в языковую модель выбранного провайдера. Если чат чувствительный, поднимите локальную
            модель через Ollama и укажите её адрес в <code className="rounded bg-secondary px-1">OPENAI_BASE_URL</code>.
          </p>
          <p>
            Baileys — неофициальный клиент WhatsApp. Приложение только читает и никогда не отправляет сообщения, но риск
            блокировки аккаунта в теории есть.
          </p>
        </CardContent>
      </Card>

      <div className="lg:col-span-2">
        <Button disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Сохранить настройки
        </Button>
      </div>
    </div>
  )
}
