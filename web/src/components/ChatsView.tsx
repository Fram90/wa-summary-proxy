import { useEffect, useMemo, useState } from 'react'
import { Download, Eye, Loader2, MessagesSquare, Search, Sparkles, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { countWithNoun, formatChatName, formatDateTime, formatRelative } from '@/lib/format'
import type { Chat, Message } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

export function ChatsView({
  chats,
  loading,
  demoMode,
  windowHours,
  onChanged,
}: {
  chats: Chat[] | null
  loading: boolean
  demoMode: boolean
  windowHours: number
  onChanged: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [busyJid, setBusyJid] = useState<string | null>(null)
  const [preview, setPreview] = useState<Chat | null>(null)

  const filtered = useMemo(() => {
    if (!chats) return null
    const needle = query.trim().toLowerCase()
    if (!needle) return chats
    return chats.filter((chat) => formatChatName(chat).toLowerCase().includes(needle) || chat.jid.includes(needle))
  }, [chats, query])

  const toggleTracked = async (chat: Chat) => {
    setBusyJid(chat.jid)
    try {
      await api.trackChat(chat.jid, chat.tracked === 0)
      await onChanged()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusyJid(null)
    }
  }

  const runDigest = async (chat: Chat) => {
    setBusyJid(chat.jid)
    toast.info(`Собираю выжимку по «${formatChatName(chat)}»…`)
    try {
      const result = await api.runDigest({ chatJid: chat.jid, hours: windowHours })
      if (result.digests.length === 0) {
        toast.warning(`За последние ${windowHours} ч в этом чате нет сообщений`)
      } else {
        toast.success('Дайджест готов — смотрите вкладку «Дайджесты»')
      }
      await onChanged()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusyJid(null)
    }
  }

  const backfill = async (chat: Chat) => {
    setBusyJid(chat.jid)
    toast.info('Прошу у WhatsApp старые сообщения, это занимает несколько секунд…')
    try {
      const result = await api.backfill(chat.jid, 3)
      toast.success(`Запрошено до ${result.requested} сообщений истории`)
      await onChanged()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusyJid(null)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <CardTitle>Чаты</CardTitle>
              <CardDescription>
                Отметьте те, за которыми стоит следить. Дайджесты собираются только по отмеченным чатам.
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск по названию"
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loading && !chats ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-20 w-full" />
              ))}
            </div>
          ) : !filtered || filtered.length === 0 ? (
            <EmptyChats hasQuery={query.trim().length > 0} />
          ) : (
            <ul className="divide-y">
              {filtered.map((chat) => {
                const busy = busyJid === chat.jid
                return (
                  <li key={chat.jid} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {chat.is_group === 1 ? (
                          <Users className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <MessagesSquare className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <p className="truncate font-medium">{formatChatName(chat)}</p>
                        {chat.tracked === 1 && (
                          <Badge variant="secondary" className="shrink-0">
                            следим
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {countWithNoun(chat.message_count, 'сообщение', 'сообщения', 'сообщений')}
                        {chat.last_message_at ? ` · последнее ${formatRelative(chat.last_message_at)}` : ''}
                        {chat.last_digest_at ? ` · дайджест ${formatRelative(chat.last_digest_at)}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button variant="ghost" size="icon-sm" title="Показать последние сообщения" onClick={() => setPreview(chat)}>
                        <Eye className="size-4" />
                      </Button>
                      {!demoMode && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Догрузить историю из WhatsApp"
                          disabled={busy}
                          onClick={() => void backfill(chat)}
                        >
                          <Download className="size-4" />
                        </Button>
                      )}
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => void runDigest(chat)}>
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                        Выжимка
                      </Button>
                      <Switch
                        checked={chat.tracked === 1}
                        disabled={busy}
                        onCheckedChange={() => void toggleTracked(chat)}
                        aria-label={`Следить за чатом ${formatChatName(chat)}`}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <MessagesPreview chat={preview} onClose={() => setPreview(null)} />
    </>
  )
}

function EmptyChats({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <MessagesSquare className="size-8 text-muted-foreground" />
      <p className="font-medium">{hasQuery ? 'Ничего не нашлось' : 'Чатов пока нет'}</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {hasQuery
          ? 'Попробуйте другой запрос — поиск идёт по названию чата и номеру.'
          : 'Чаты появятся после привязки устройства: WhatsApp пришлёт список и историю переписки сам.'}
      </p>
    </div>
  )
}

function MessagesPreview({ chat, onClose }: { chat: Chat | null; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!chat) {
      setMessages(null)
      setError(null)
      return
    }

    let cancelled = false
    api
      .messages(chat.jid, 60)
      .then((result) => {
        if (!cancelled) setMessages(result)
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message)
      })

    return () => {
      cancelled = true
    }
  }, [chat])

  return (
    <Dialog open={chat !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{chat ? formatChatName(chat) : ''}</DialogTitle>
        </DialogHeader>

        {error ? (
          <p className="py-6 text-sm text-destructive">{error}</p>
        ) : !messages ? (
          <div className="space-y-2 py-2">
            {[0, 1, 2, 3, 4].map((index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">Сохранённых сообщений нет.</p>
        ) : (
          <ScrollArea className="h-[60vh] pr-4">
            <ul className="space-y-3">
              {messages.map((message) => (
                <li key={message.id} className="text-sm">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium">{message.sender_name ?? 'Участник'}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(message.ts)}</span>
                    {message.mentions_me === 1 && (
                      <Badge variant="outline" className="text-[10px]">
                        обращение к вам
                      </Badge>
                    )}
                  </div>
                  {message.quoted_text && (
                    <p className="mt-1 border-l-2 pl-2 text-xs text-muted-foreground">{message.quoted_text}</p>
                  )}
                  <p className="whitespace-pre-wrap">{message.text}</p>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}
