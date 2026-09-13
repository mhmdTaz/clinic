import type { DehydratedState } from '@tanstack/react-query'
import type { SessionUser } from '@clinic/contracts'

/**
 * What a person can still see with no signal (§9.4: "persist the cache for offline reads").
 *
 * The case this is for is specific and worth naming: somebody standing outside the clinic with
 * one bar, wanting to know what time their appointment is. That is a *read* of something they
 * have already been shown. Everything else — booking, cancelling, replying, writing a note — needs
 * the server, and pretending otherwise by queueing writes offline would be worse than refusing: a
 * booking that syncs an hour later may land on a slot somebody else has taken, and the patient has
 * already been told they have it.
 *
 * So: reads are kept, writes are not queued, and the screens say which they are showing.
 *
 * This file is the rules. Where the bytes live, and how they are encrypted, is `device/vault.ts`.
 */

/**
 * How old a kept read may be before the app stops showing it at all.
 *
 * Not a freshness policy — React Query handles that — but a floor on *staleness that would
 * mislead*. A week-old appointment list is not "slightly out of date", it is a different week,
 * and showing it with an "offline" label would still have somebody turn up on the wrong day.
 */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Which queries are worth keeping.
 *
 * An allowlist rather than everything, for two reasons. A device holds PHI at rest and the less of
 * it the better — a statement, a document list, a chart or a note is a liability on a lost phone
 * with no corresponding benefit. And a cache of everything is a cache nobody can reason about.
 *
 * For a doctor, `appointments` is the day list: patient names and times, which is what a doctor in
 * a basement consulting room needs to know who is next. The chart and the note are never kept.
 */
const OFFLINE_READABLE: readonly string[] = ['me', 'appointments', 'notifications']

export const isCacheable = (queryKey: readonly unknown[]): boolean =>
  typeof queryKey[0] === 'string' && OFFLINE_READABLE.includes(queryKey[0])

/**
 * Whether a kept read may still be shown.
 *
 * A negative age means the device clock moved backwards, which is a reason to distrust the entry
 * rather than to treat it as freshly fetched.
 */
export function isUsable(
  entry: { fetchedAt: number },
  now: number,
  maxAgeMs = MAX_AGE_MS,
): boolean {
  if (!Number.isFinite(entry.fetchedAt)) return false
  const age = now - entry.fetchedAt
  return age >= 0 && age <= maxAgeMs
}

/** Only what may be kept, and only while it may still be shown. */
export function restorable(state: DehydratedState, now: number): DehydratedState {
  return {
    mutations: [],
    queries: state.queries.filter(
      (query) =>
        isCacheable(query.queryKey) &&
        query.state.status === 'success' &&
        isUsable({ fetchedAt: query.state.dataUpdatedAt }, now),
    ),
  }
}

/** The person the kept reads belong to, if the session itself was kept. */
export function keptUser(state: DehydratedState): SessionUser | null {
  const entry = state.queries.find(
    (query) => query.queryKey.length === 1 && query.queryKey[0] === 'me',
  )
  const user = entry?.state.data as Partial<SessionUser> | undefined
  // A shape check, not a full parse: this is our own write, and the fields that matter are the
  // ones every screen reads before anything else.
  if (!user || typeof user.id !== 'string' || typeof user.clinic?.timezone !== 'string') return null
  return user as SessionUser
}

/** Where the kept reads are stored. Encrypted on a device; see `device/vault.ts`. */
export interface Vault {
  read(): Promise<string | null>
  write(text: string): Promise<void>
  /** Gone, including the key — a sign-out destroys rather than empties. */
  destroy(): Promise<void>
}

export interface KeptReads {
  /** The user the reads were fetched for. Nobody else is ever shown them. */
  ownerId: string
  savedAt: number
  state: DehydratedState
}

const FORMAT_VERSION = 1

export function createOfflineStore(vault: Vault, now: () => number = Date.now) {
  async function destroy(): Promise<void> {
    try {
      await vault.destroy()
    } catch {
      // Nothing to do about a store that will not delete. The key is destroyed first (see the
      // vault), so what is left is unreadable.
    }
  }

  return {
    async save(ownerId: string, state: DehydratedState): Promise<void> {
      const at = now()
      const kept: KeptReads = { ownerId, savedAt: at, state: restorable(state, at) }
      await vault.write(JSON.stringify({ v: FORMAT_VERSION, ...kept }))
    },

    /**
     * What was kept, if it can still be shown.
     *
     * Every failure is a miss, never a crash: a vault that will not decrypt (a restored backup, a
     * wiped keychain), a file from an older build, or plain corruption. Launching with no signal
     * is the one moment this matters, and an exception there is an app that will not open.
     */
    async load(): Promise<KeptReads | null> {
      let raw: string | null
      try {
        raw = await vault.read()
      } catch {
        await destroy()
        return null
      }
      if (!raw) return null

      let parsed: Partial<KeptReads> & { v?: unknown }
      try {
        parsed = JSON.parse(raw) as Partial<KeptReads> & { v?: unknown }
      } catch {
        await destroy()
        return null
      }
      if (
        parsed.v !== FORMAT_VERSION ||
        typeof parsed.ownerId !== 'string' ||
        typeof parsed.savedAt !== 'number' ||
        !Array.isArray(parsed.state?.queries)
      ) {
        await destroy()
        return null
      }

      const state = restorable(parsed.state, now())
      if (state.queries.length === 0) return null
      return { ownerId: parsed.ownerId, savedAt: parsed.savedAt, state }
    },

    destroy,
  }
}

export type OfflineStore = ReturnType<typeof createOfflineStore>

// ── Launch ───────────────────────────────────────────────────────────────────

export type WhoAmI =
  { ok: true; user: SessionUser } | { ok: false; transient: boolean; code: string }

export type LaunchOutcome =
  | { status: 'signedOut'; reason: 'never' | 'expired'; discardKept: boolean }
  | {
      status: 'signedIn'
      user: SessionUser
      offline: boolean
      adoptKept: boolean
      discardKept: boolean
    }
  | { status: 'unreachable'; reason: 'network' | 'outdated' }

/**
 * What to show on launch, from what the keychain holds, what the server said, and what was kept.
 *
 * **Unreachable is not signed out.** The first version of the app answered a launch with no
 * signal by showing the sign-in screen — which the person cannot complete with no signal either —
 * while its own comment said the opposite. The case the offline cache exists for, somebody outside
 * the clinic with one bar, is exactly the case that sent them to a dead end.
 *
 * **Kept reads are only ever shown to the person they were fetched for.** A phone can change
 * hands between two launches.
 */
export function decideLaunch(input: {
  hasTokens: boolean
  whoAmI: WhoAmI | null
  kept: KeptReads | null
}): LaunchOutcome {
  const { hasTokens, whoAmI, kept } = input

  if (!hasTokens || !whoAmI) {
    return { status: 'signedOut', reason: 'never', discardKept: kept !== null }
  }

  if (whoAmI.ok) {
    const theirs = kept !== null && kept.ownerId === whoAmI.user.id
    return {
      status: 'signedIn',
      user: whoAmI.user,
      offline: false,
      adoptKept: theirs,
      discardKept: kept !== null && !theirs,
    }
  }

  // The response did not match this build's contracts: an app months older than its server.
  // Signing the person out would not help — signing in again would fail the same way.
  if (whoAmI.code === 'CONTRACT_MISMATCH') return { status: 'unreachable', reason: 'outdated' }

  if (!whoAmI.transient) {
    return { status: 'signedOut', reason: 'expired', discardKept: kept !== null }
  }

  const user = kept ? keptUser(kept.state) : null
  if (kept && user && user.id === kept.ownerId) {
    return { status: 'signedIn', user, offline: true, adoptKept: true, discardKept: false }
  }
  return { status: 'unreachable', reason: 'network' }
}
