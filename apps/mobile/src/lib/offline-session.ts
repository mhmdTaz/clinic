import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@clinic/api-client'
import type { SessionUser } from '@clinic/contracts'
import { isCacheable, type KeptReads, type OfflineStore } from './offline'

/**
 * The offline store, attached to the app's query cache for the length of one person's session.
 *
 * The first version of the app had the store and its tests, and never attached it: nothing wrote
 * a query to it, and nothing read one back. Everything below exists to make that connection, and
 * `offline-session.test.ts` drives it through a real `QueryClient` so it cannot quietly come
 * undone again.
 */
export function createOfflineSession(
  queryClient: QueryClient,
  store: OfflineStore,
  options: { throttleMs?: number } = {},
) {
  const throttleMs = options.throttleMs ?? 2_000
  let owner: string | null = null
  let unsubscribe: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let writing: Promise<void> = Promise.resolve()

  const snapshot = () =>
    dehydrate(queryClient, {
      shouldDehydrateQuery: (query) =>
        isCacheable(query.queryKey) && query.state.status === 'success',
    })

  function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const who = owner
    if (!who) return writing
    // Serialised: two writes racing could land the older snapshot last.
    writing = writing
      .then(() => store.save(who, snapshot()))
      // A failed write is a miss on the next launch, which is survivable. An unhandled rejection
      // from a background timer is not.
      .catch(() => undefined)
    return writing
  }

  return {
    load: (): Promise<KeptReads | null> => store.load(),

    /** Puts back what was kept, so the first screen renders before the network answers. */
    adopt(kept: KeptReads): void {
      hydrate(queryClient, kept.state)
    },

    /** Starts keeping reads for this person. */
    begin(user: SessionUser): void {
      if (owner !== null && owner !== user.id) queryClient.clear()
      owner = user.id
      queryClient.setQueryData(queryKeys.me(), user)

      unsubscribe?.()
      unsubscribe = queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'success') return
        if (!isCacheable(event.query.queryKey) || timer) return
        // Trailing, so a screen that loads three lists at once is one write rather than three.
        timer = setTimeout(() => void flush(), throttleMs)
      })
      void flush()
    },

    /** Writes now — when the app goes to the background, which may be the last chance. */
    flush,

    /** Deletes what was kept without touching the session: somebody else's reads. */
    discard: (): Promise<void> => store.destroy(),

    /**
     * Everything this person left on the phone, gone: memory and storage.
     *
     * Not optional on sign-out. The next person to sign in on a shared phone must not be shown
     * the previous one's appointments while their own load.
     */
    async end(): Promise<void> {
      unsubscribe?.()
      unsubscribe = null
      if (timer) clearTimeout(timer)
      timer = null
      owner = null
      // Let a write already under way land before the store is destroyed, or it would recreate
      // the file a moment after the sign-out deleted it.
      await writing
      queryClient.clear()
      await store.destroy()
    },
  }
}

export type OfflineSession = ReturnType<typeof createOfflineSession>
