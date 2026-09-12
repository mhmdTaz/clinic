/**
 * What a patient can still see with no signal (§9.4: "persist the cache for offline reads").
 *
 * The case this is for is specific and worth naming: somebody standing outside the clinic with
 * one bar, wanting to know what time their appointment is. That is a *read* of something they
 * have already been shown. Everything else — booking, cancelling, replying — needs the server,
 * and pretending otherwise by queueing writes offline would be worse than refusing: a booking
 * that syncs an hour later may land on a slot somebody else has taken, and the patient has
 * already been told they have it.
 *
 * So: reads are cached, writes are not queued, and the app says which it is doing.
 */

/** A cached response with the moment it was fetched. */
export interface CachedEntry {
  data: unknown
  fetchedAt: number
}

export interface CacheStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  /** Keys currently held, so a sign-out can clear everything belonging to a person. */
  keys(): Promise<string[]>
}

const PREFIX = 'clinic.cache.'

/**
 * How old a cached read may be before the app stops showing it at all.
 *
 * Not a freshness policy — React Query handles that — but a floor on *staleness that would
 * mislead*. A week-old appointment list is not "slightly out of date", it is a different week,
 * and showing it with an "offline" label would still have somebody turn up on the wrong day.
 */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Which queries are worth keeping for offline reading.
 *
 * An allowlist rather than everything, for two reasons. A device holds PHI at rest and the less
 * of it the better — a cached statement or a cached document list is a liability on a lost phone
 * with no corresponding benefit. And a cache of everything is a cache nobody can reason about
 * when it goes stale.
 */
const OFFLINE_READABLE: readonly string[] = ['me', 'appointments', 'notifications']

export const isCacheable = (queryKey: readonly unknown[]): boolean =>
  typeof queryKey[0] === 'string' && OFFLINE_READABLE.includes(queryKey[0])

export function cacheKeyOf(queryKey: readonly unknown[]): string {
  return `${PREFIX}${JSON.stringify(queryKey)}`
}

/**
 * Whether a cached entry may still be shown.
 *
 * Separated from the storage so the rule is testable without a device — it is the rule that
 * decides whether somebody is shown a time that might be wrong.
 */
export function isUsable(entry: CachedEntry, now: number, maxAgeMs = MAX_AGE_MS): boolean {
  if (!Number.isFinite(entry.fetchedAt)) return false
  const age = now - entry.fetchedAt
  // A negative age means the device clock moved backwards, which is a reason to distrust the
  // entry rather than to treat it as freshly fetched.
  return age >= 0 && age <= maxAgeMs
}

export function createOfflineCache(storage: CacheStorage, now: () => number = Date.now) {
  return {
    async read(queryKey: readonly unknown[]): Promise<unknown | undefined> {
      if (!isCacheable(queryKey)) return undefined
      const raw = await storage.getItem(cacheKeyOf(queryKey))
      if (!raw) return undefined

      let entry: CachedEntry
      try {
        entry = JSON.parse(raw) as CachedEntry
      } catch {
        // Corrupt storage is a cache miss, never a crash on launch.
        await storage.removeItem(cacheKeyOf(queryKey))
        return undefined
      }

      if (!isUsable(entry, now())) {
        await storage.removeItem(cacheKeyOf(queryKey))
        return undefined
      }
      return entry.data
    },

    async write(queryKey: readonly unknown[], data: unknown): Promise<void> {
      if (!isCacheable(queryKey)) return
      const entry: CachedEntry = { data, fetchedAt: now() }
      await storage.setItem(cacheKeyOf(queryKey), JSON.stringify(entry))
    },

    /**
     * Everything this app cached, gone.
     *
     * Called on sign-out, and it is not optional: the next person to sign in on a shared phone
     * must not be shown the previous one's appointments while their own load.
     */
    async clear(): Promise<void> {
      const keys = await storage.keys()
      await Promise.all(
        keys.filter((key) => key.startsWith(PREFIX)).map((key) => storage.removeItem(key)),
      )
    },
  }
}

export type OfflineCache = ReturnType<typeof createOfflineCache>
