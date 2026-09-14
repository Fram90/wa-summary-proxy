import { useCallback, useEffect, useRef, useState } from 'react'
import { UnauthorizedError } from '@/lib/api'

interface PollResult<T> {
  data: T | null
  error: string | null
  unauthorized: boolean
  loading: boolean
  refresh: () => Promise<void>
}

/** Тянет данные с сервера и повторяет запрос по таймеру; ошибка не сбрасывает уже показанные данные. */
export function usePoll<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  options: { paused?: boolean } = {},
): PollResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)
  const [loading, setLoading] = useState(true)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const refresh = useCallback(async () => {
    try {
      const result = await fetcherRef.current()
      setData(result)
      setError(null)
      setUnauthorized(false)
    } catch (cause) {
      if (cause instanceof UnauthorizedError) setUnauthorized(true)
      else setError((cause as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Пока пользователь читает раскрытый дайджест, обновление на паузе: иначе список
  // перерисовывается и текст уезжает из-под курсора.
  useEffect(() => {
    if (intervalMs <= 0 || options.paused) return

    const timer = setInterval(() => void refresh(), intervalMs)
    return () => clearInterval(timer)
  }, [refresh, intervalMs, options.paused])

  return { data, error, unauthorized, loading, refresh }
}
