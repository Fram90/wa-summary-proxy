import { useCallback } from 'react'
import { FlaskConical, MessageSquareText } from 'lucide-react'
import { api } from '@/lib/api'
import { usePoll } from '@/hooks/usePoll'
import { ChatsView } from '@/components/ChatsView'
import { ConnectionView } from '@/components/ConnectionView'
import { DigestsView } from '@/components/DigestsView'
import { SettingsView } from '@/components/SettingsView'
import { StatusPill } from '@/components/StatusPill'
import { TokenGate } from '@/components/TokenGate'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toaster } from '@/components/ui/sonner'

export default function App() {
  const state = usePoll(api.state, 4000)
  const chats = usePoll(() => api.chats(), 10_000)
  const digests = usePoll(() => api.digests(), 10_000)

  const refreshAll = useCallback(async () => {
    await Promise.all([state.refresh(), chats.refresh(), digests.refresh()])
  }, [state.refresh, chats.refresh, digests.refresh])

  if (state.unauthorized) {
    return <TokenGate onSubmit={() => void refreshAll()} />
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <MessageSquareText className="size-5" />
            </div>
            <div>
              <h1 className="leading-tight font-semibold">Дайджесты WhatsApp</h1>
              <p className="text-xs text-muted-foreground">Читает ваши чаты, присылает выжимки в Telegram</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {state.data?.demoMode && (
              <Badge variant="outline" className="gap-1">
                <FlaskConical className="size-3" />
                демо-режим
              </Badge>
            )}
            {state.data && <StatusPill status={state.data.session.status} />}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {state.error && !state.data && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
            Сервер не отвечает: {state.error}
          </div>
        )}

        {!state.data ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full max-w-md" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <Tabs defaultValue={state.data.session.status === 'open' ? 'digests' : 'connection'}>
            <TabsList className="mb-6">
              <TabsTrigger value="connection">Подключение</TabsTrigger>
              <TabsTrigger value="chats">
                Чаты
                {state.data.stats.trackedChats > 0 && (
                  <span className="ml-1 text-xs text-muted-foreground">{state.data.stats.trackedChats}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="digests">Дайджесты</TabsTrigger>
              <TabsTrigger value="settings">Настройки</TabsTrigger>
            </TabsList>

            <TabsContent value="connection">
              <ConnectionView state={state.data} onRefresh={refreshAll} />
            </TabsContent>

            <TabsContent value="chats">
              <ChatsView
                chats={chats.data}
                loading={chats.loading}
                demoMode={state.data.demoMode}
                windowHours={state.data.settings.digestWindowHours}
                onChanged={refreshAll}
              />
            </TabsContent>

            <TabsContent value="digests">
              <DigestsView
                digests={digests.data}
                loading={digests.loading}
                trackedChats={state.data.stats.trackedChats}
                defaultHours={state.data.settings.digestWindowHours}
                onChanged={refreshAll}
              />
            </TabsContent>

            <TabsContent value="settings">
              <SettingsView state={state.data} onChanged={refreshAll} />
            </TabsContent>
          </Tabs>
        )}
      </main>

      <Toaster position="bottom-right" />
    </div>
  )
}
