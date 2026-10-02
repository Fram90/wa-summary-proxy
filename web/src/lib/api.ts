import type { AppSettings, AppState, Chat, Digest, Message } from './types'

export interface DigestRunResult {
  digests: { id: number; chatName: string }[]
  skipped: { chatJid: string; chatName: string; reason: 'no_new' | 'empty' }[]
}

export function digestRunMessage(result: DigestRunResult): { ok: boolean; text: string } {
  if (result.digests.length > 0) {
    const count = result.digests.length
    const noun = count % 10 === 1 && count % 100 !== 11 ? 'дайджест' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20) ? 'дайджеста' : 'дайджестов'
    return { ok: true, text: `Готово: ${count} ${noun}` }
  }
  if (result.skipped.some((item) => item.reason === 'no_new')) {
    return { ok: false, text: 'Новых сообщений с прошлого дайджеста нет — модель не вызывалась' }
  }
  return { ok: false, text: 'За выбранный период сообщений нет' }
}

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

// Тело отправляем всегда: POST с заголовком application/json и пустым телом Fastify считает битым запросом.
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) })

export const api = {
  state: () => request<AppState>('/state'),

  chats: (query?: string) =>
    request<{ chats: Chat[] }>(`/chats${query ? `?query=${encodeURIComponent(query)}` : ''}`).then((r) => r.chats),

  trackChat: (jid: string, tracked: boolean) =>
    post<{ ok: true }>(`/chats/${encodeURIComponent(jid)}/track`, { tracked }),

  savePrompt: (jid: string, prompt: string) =>
    request<{ ok: true }>(`/chats/${encodeURIComponent(jid)}/prompt`, {
      method: 'PUT',
      body: JSON.stringify({ prompt }),
    }),

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

  runDigest: (options: { chatJid?: string; hours: number; force?: boolean }) =>
    post<DigestRunResult>('/digests/run', options),

  saveSettings: (patch: Partial<AppSettings>) =>
    request<{ settings: AppSettings }>('/settings', { method: 'PUT', body: JSON.stringify(patch) }).then(
      (r) => r.settings,
    ),

  resetSession: () => post<{ ok: true }>('/session/reset'),
  demoConnect: () => post<{ ok: true }>('/session/demo-connect'),
  testTelegram: () => post<{ ok: true }>('/telegram/test'),
}
