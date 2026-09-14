import { cn } from 'cn'
import type { ConnectionStatus } from '@/lib/types'

export const statusMeta: Record<ConnectionStatus, { label: string; dot: string; text: string }> = {
  starting: { label: 'Запускается', dot: 'bg-muted-foreground', text: 'text-muted-foreground' },
  need_pairing: { label: 'Нужна привязка', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  connecting: { label: 'Подключается', dot: 'bg-sky-500 animate-pulse', text: 'text-sky-600 dark:text-sky-400' },
  open: { label: 'Подключено', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  reconnecting: {
    label: 'Переподключается',
    dot: 'bg-amber-500 animate-pulse',
    text: 'text-amber-600 dark:text-amber-400',
  },
  logged_out: { label: 'Устройство отвязано', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  error: { label: 'Ошибка', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
}

export function StatusPill({ status, className }: { status: ConnectionStatus; className?: string }) {
  const meta = statusMeta[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium',
        meta.text,
        className,
      )}
    >
      <span className={cn('size-2 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  )
}
