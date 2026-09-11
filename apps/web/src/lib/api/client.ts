/**
 * The browser's API client. Client-safe: it imports nothing from the server packages.
 *
 * On TOKEN_EXPIRED it refreshes once and retries, so a user mid-form when their fifteen
 * minutes run out never notices. Two requests expiring together both refresh; the server's
 * reuse grace window treats that as concurrency, not theft.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Array<{ field: string; issue: string }> = [],
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
}

type Envelope<T> = {
  data?: T
  error?: { code?: string; message?: string; details?: Array<{ field: string; issue: string }> }
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const hasBody = options.body !== undefined
  return fetch(path, {
    method: options.method ?? 'GET',
    headers: hasBody ? { 'content-type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
  })
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options)
  let payload = (await response.json().catch(() => null)) as Envelope<T> | null

  const expired = response.status === 401 && payload?.error?.code === 'TOKEN_EXPIRED'
  if (expired && !path.startsWith('/api/v1/auth/')) {
    const refreshed = await send('/api/v1/auth/refresh', { method: 'POST', body: {} })
    if (refreshed.ok) {
      response = await send(path, options)
      payload = (await response.json().catch(() => null)) as Envelope<T> | null
    }
  }

  if (response.ok) return payload?.data as T

  const retryAfter = Number(response.headers.get('retry-after'))
  throw new ApiError(
    response.status,
    payload?.error?.code ?? (response.status >= 500 ? 'INTERNAL_ERROR' : 'NETWORK_ERROR'),
    payload?.error?.message ?? `Request failed with status ${response.status}`,
    payload?.error?.details ?? [],
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
  )
}
