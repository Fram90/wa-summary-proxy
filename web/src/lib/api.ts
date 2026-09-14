import type { AppSettings, AppState, Chat, Digest, Message } from './types'

const TOKEN_KEY = 'wa-digest-token'

export class UnauthorizedError extends Error {
  constructor() {
    super('Нужен токен панели')
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-dashboard-token': token } : {}),
      ...init?.headers,
    },
  })

  if (response.status === 401) throw new UnauthorizedError()

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Ошибка ${response.status}`)
  }

  return response.json() as Promise<T>
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined })

export const api = {
  state: () => request<AppState>('/state'),

  chats: (query?: string) =>
    request<{ chats: Chat[] }>(`/chats${query ? `?query=${encodeURIComponent(query)}` : ''}`).then((r) => r.chats),

  trackChat: (jid: string, tracked: boolean) =>
    post<{ ok: true }>(`/chats/${encodeURIComponent(jid)}/track`, { tracked }),

  messages: (jid: string, limit = 40) =>
    request<{ messages: Message[] }>(`/chats/${encodeURIComponent(jid)}/messages?limit=${limit}`).then(
      (r) => r.messages,
    ),

  backfill: (jid: string, batches = 3) =>
    post<{ ok: true; requested: number }>(`/chats/${encodeURIComponent(jid)}/backfill`, { batches }),

  digests: (chatJid?: string) =>
    request<{ digests: Digest[] }>(`/digests${chatJid ? `?chat=${encodeURIComponent(chatJid)}` : ''}`).then(
      (r) => r.digests,
    ),

  runDigest: (options: { chatJid?: string; hours: number }) =>
    post<{ digests: { id: number; chatName: string }[] }>('/digests/run', options),

  saveSettings: (patch: Partial<AppSettings>) =>
    request<{ settings: AppSettings }>('/settings', { method: 'PUT', body: JSON.stringify(patch) }).then(
      (r) => r.settings,
    ),

  resetSession: () => post<{ ok: true }>('/session/reset'),
  demoConnect: () => post<{ ok: true }>('/session/demo-connect'),
  testTelegram: () => post<{ ok: true }>('/telegram/test'),
}
