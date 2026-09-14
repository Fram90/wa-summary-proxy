import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { setToken } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function TokenGate({ onSubmit }: { onSubmit: () => void }) {
  const [value, setValue] = useState('')

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-secondary">
            <KeyRound className="size-5" />
          </div>
          <CardTitle>Панель закрыта токеном</CardTitle>
          <CardDescription>
            Введите значение <code className="rounded bg-secondary px-1">DASHBOARD_TOKEN</code> из вашего файла
            <code className="ml-1 rounded bg-secondary px-1">.env</code>. Он сохранится в этом браузере.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              setToken(value.trim() || null)
              onSubmit()
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="token">Токен</Label>
              <Input
                id="token"
                type="password"
                autoFocus
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" className="w-full" disabled={value.trim().length === 0}>
              Войти
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
