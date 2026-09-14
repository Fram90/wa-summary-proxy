import { useState } from 'react'
import { CheckCheck, FileText, Loader2, Send, Sparkles, TriangleAlert } from 'lucide-react'
import Markdown from 'react-markdown'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { countWithNoun, formatPeriod, formatRelative } from '@/lib/format'
import type { Digest } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

const windowOptions = [
  { value: '3', label: 'за 3 часа' },
  { value: '12', label: 'за 12 часов' },
  { value: '24', label: 'за сутки' },
  { value: '72', label: 'за 3 дня' },
  { value: '168', label: 'за неделю' },
]

const triggerLabels: Record<string, string> = {
  schedule: 'по расписанию',
  manual: 'из панели',
  telegram: 'из Telegram',
}

export function DigestsView({
  digests,
  loading,
  trackedChats,
  defaultHours,
  onChanged,
}: {
  digests: Digest[] | null
  loading: boolean
  trackedChats: number
  defaultHours: number
  onChanged: () => Promise<void>
}) {
  const [hours, setHours] = useState(String(defaultHours))
  const [running, setRunning] = useState(false)
  const [openId, setOpenId] = useState<number | null>(null)

  const runAll = async () => {
    setRunning(true)
    try {
      const result = await api.runDigest({ hours: Number(hours) })
      if (result.digests.length === 0) {
        toast.warning('Новых сообщений за этот период нет')
      } else {
        toast.success(`Готово: ${countWithNoun(result.digests.length, 'дайджест', 'дайджеста', 'дайджестов')}`)
      }
      await onChanged()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <CardTitle>Дайджесты</CardTitle>
            <CardDescription>
              Выжимки по отслеживаемым чатам. Те же тексты уходят в Telegram, если бот настроен.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={hours} onValueChange={setHours}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {windowOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button disabled={running || trackedChats === 0} onClick={() => void runAll()}>
              {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Собрать сейчас
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {trackedChats === 0 && (
          <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Ни один чат не отмечен как отслеживаемый — собирать нечего. Отметьте нужный чат на вкладке «Чаты».
          </p>
        )}

        {loading && !digests ? (
          <div className="space-y-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-24 w-full" />
            ))}
          </div>
        ) : !digests || digests.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <FileText className="size-8 text-muted-foreground" />
            <p className="font-medium">Дайджестов пока нет</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Соберите первую выжимку кнопкой выше или дождитесь планового запуска.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {digests.map((digest) => {
              const open = openId === digest.id
              return (
                <li key={digest.id} className="rounded-lg border">
                  <button
                    type="button"
                    className="flex w-full flex-col gap-2 p-4 text-left hover:bg-secondary/40"
                    onClick={() => setOpenId(open ? null : digest.id)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{digest.chat_name ?? digest.chat_jid}</span>
                      <Badge variant="secondary">{triggerLabels[digest.trigger] ?? digest.trigger}</Badge>
                      {digest.delivered_at ? (
                        <Badge variant="outline" className="gap-1 text-emerald-600 dark:text-emerald-400">
                          <CheckCheck className="size-3" />
                          в Telegram
                        </Badge>
                      ) : digest.delivery_error ? (
                        <Badge variant="outline" className="gap-1 text-red-600 dark:text-red-400">
                          <TriangleAlert className="size-3" />
                          не доставлен
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          <Send className="size-3" />
                          только здесь
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatPeriod(digest.period_start, digest.period_end)} ·{' '}
                      {countWithNoun(digest.message_count, 'сообщение', 'сообщения', 'сообщений')} · {digest.model}
                      {digest.tokens_in > 0
                        ? ` · ${(digest.tokens_in + digest.tokens_out).toLocaleString('ru-RU')} токенов`
                        : ''}{' '}
                      · собран {formatRelative(digest.created_at)}
                    </p>
                  </button>

                  {open && (
                    <div className="border-t p-4">
                      {digest.delivery_error && (
                        <p className="mb-3 rounded border border-red-500/40 bg-red-500/10 p-2 text-xs">
                          Telegram вернул ошибку: {digest.delivery_error}
                        </p>
                      )}
                      <DigestBody markdown={digest.summary_md} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function DigestBody({ markdown }: { markdown: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      <Markdown
        components={{
          p: ({ children }) => <p className="text-foreground/90">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          ul: ({ children }) => <ul className="ml-4 list-disc space-y-1 text-foreground/90">{children}</ul>,
          ol: ({ children }) => <ol className="ml-4 list-decimal space-y-1 text-foreground/90">{children}</ol>,
          h1: ({ children }) => <p className="text-base font-semibold">{children}</p>,
          h2: ({ children }) => <p className="text-base font-semibold">{children}</p>,
          h3: ({ children }) => <p className="font-semibold">{children}</p>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
              {children}
            </a>
          ),
          code: ({ children }) => <code className="rounded bg-secondary px-1 py-0.5 text-xs">{children}</code>,
        }}
      >
        {markdown}
      </Markdown>
    </div>
  )
}
