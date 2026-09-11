import { createHash } from 'node:crypto'
import { Redis } from 'ioredis'
import { env, processSingleton } from '@clinic/config'
import type { RateLimitRule } from '../domain/auth-policy'

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
}

// One connection per process, not one per bundle copy of this module.
const shared = processSingleton('identity:rate-limit-store', () => ({
  client: null as Redis | null,
  lastErrorReportedAt: 0,
}))

function redis(): Redis {
  if (!shared.client) {
    shared.client = new Redis(env().REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      commandTimeout: 1_000,
    })
    shared.client.on('error', reportError)
  }
  return shared.client
}

function reportError(error: unknown): void {
  const now = Date.now()
  if (now - shared.lastErrorReportedAt < 60_000) return // one line a minute, not one per request
  shared.lastErrorReportedAt = now
  console.error('[rate-limit] Redis unavailable — rate limiting is failing open', error)
}

/** Emails are hashed before they become Redis keys, so no address sits in a cache dump. */
export function rateLimitKey(...parts: string[]): string {
  return parts
    .map((part) =>
      part.includes('@') ? createHash('sha256').update(part).digest('hex').slice(0, 32) : part,
    )
    .join(':')
}

/**
 * Fixed-window counter. INCR and EXPIRE NX run in one MULTI, so the window starts at the
 * first hit and is never extended by later ones.
 *
 * Fails OPEN: a Redis outage must not lock every patient and doctor out of the clinic.
 * Per-account lockout lives in MongoDB and keeps protecting accounts regardless.
 */
export const rateLimiter = {
  async hit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const redisKey = `rl:${key}`
    try {
      const results = await redis()
        .multi()
        .incr(redisKey)
        .expire(redisKey, rule.windowSeconds, 'NX')
        .ttl(redisKey)
        .exec()

      const count = Number(results?.[0]?.[1] ?? 0)
      const ttl = Number(results?.[2]?.[1] ?? rule.windowSeconds)
      return {
        allowed: count <= rule.limit,
        retryAfterSeconds: Math.max(1, ttl > 0 ? ttl : rule.windowSeconds),
      }
    } catch (error) {
      reportError(error)
      return { allowed: true, retryAfterSeconds: 0 }
    }
  },

  /** Round-trip time in milliseconds. Throws when Redis is unreachable. */
  async ping(): Promise<number> {
    const started = performance.now()
    await redis().ping()
    return Math.round(performance.now() - started)
  },

  async reset(key: string): Promise<void> {
    try {
      await redis().del(`rl:${key}`)
    } catch (error) {
      reportError(error)
    }
  },

  async close(): Promise<void> {
    const current = shared.client
    shared.client = null
    await current?.quit().catch(() => undefined)
  },
}
