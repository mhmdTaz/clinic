import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AppState } from 'react-native'
import type { SessionUser } from '@clinic/contracts'
import { ApiError } from '@clinic/api-client'
import { auth, client, onSessionChanged } from './api'
import { decideLaunch, type WhoAmI } from './offline'
import type { OfflineSession } from './offline-session'

/**
 * Who is signed in, for the whole app (§10).
 *
 * Four states, and the two that are not "in" or "out" are the ones that matter on a phone:
 *
 * - `loading` covers launch, before the keychain has been read. An app that took "no user yet" to
 *   mean "signed out" would flash the sign-in screen at a signed-in person on every launch.
 * - `unreachable` is a session the server could not confirm, with nothing kept to show. **It is
 *   not signed out**: the tokens stay, and the screen says to find a signal rather than asking for
 *   a password the person could not submit anyway.
 *
 * And `signedIn` carries `offline`: a session confirmed from what this phone kept, shown with the
 * reads it kept, until the server can be asked again.
 */

export type SessionState =
  | { status: 'loading' }
  | { status: 'unreachable'; reason: 'network' | 'outdated' }
  | { status: 'signedOut'; reason: 'never' | 'expired' | 'signedOut' }
  | { status: 'signedIn'; user: SessionUser; offline: boolean }

interface SessionContextValue {
  state: SessionState
  /** The person most recently signed in, for a screen's last render on its way out. */
  lastUser: SessionUser | null
  signIn(email: string, password: string): Promise<void>
  /** Always ends signed out on this phone, whether or not the server could be told. */
  signOut(): Promise<void>
  /** Asks the server again — from the "cannot reach the clinic" screen, or on coming back. */
  reconnect(): Promise<void>
  /** Set when the last sign-in attempt failed, for the form to show. */
  error: unknown
}

const SessionContext = createContext<SessionContextValue | null>(null)

const whoAmI = async (): Promise<WhoAmI> => {
  try {
    return { ok: true, user: await auth.me() }
  } catch (caught) {
    return caught instanceof ApiError
      ? { ok: false, transient: caught.isTransient, code: caught.code }
      : // Not a response at all. Keeping the tokens is the safe way to be wrong.
        { ok: false, transient: true, code: 'UNKNOWN' }
  }
}

export function SessionProvider({
  children,
  offline,
  deviceName,
  onConfirmed,
  pushTokenForSignOut,
  onSignedOut,
}: {
  children: ReactNode
  /** The offline reads for this person's session. */
  offline: OfflineSession
  /** How this phone is named in the person's list of sessions. */
  deviceName?: string | null
  /** A session the server has just confirmed — the moment to renew push registration. */
  onConfirmed?: (user: SessionUser) => void
  /** This phone's push token, sent with the sign-out so it stops receiving in the same request. */
  pushTokenForSignOut?: () => Promise<string | null>
  /** Anything else of this person's that outlives the session on the phone. */
  onSignedOut?: () => Promise<void>
}) {
  const [state, setState] = useState<SessionState>({ status: 'loading' })
  const [error, setError] = useState<unknown>(null)
  const current = useRef(state)
  current.current = state
  const lastUser = useRef<SessionUser | null>(null)
  if (state.status === 'signedIn') lastUser.current = state.user

  const endLocally = useCallback(
    async (reason: 'expired' | 'signedOut' | 'never') => {
      await offline.end()
      await onSignedOut?.().catch(() => undefined)
      setState({ status: 'signedOut', reason })
    },
    [offline, onSignedOut],
  )

  /**
   * Launch: is there a session in the keychain the server still honours — and if the server
   * cannot be asked, did this phone keep enough to show the person something true?
   *
   * The server is asked rather than the stored token trusted, because a token can be valid on its
   * face and revoked in fact — signed out from another device, suspended, roles changed.
   */
  const establish = useCallback(async () => {
    const stored = await client.tokens.read()
    const kept = await offline.load()
    const outcome = decideLaunch({
      hasTokens: stored !== null,
      whoAmI: stored ? await whoAmI() : null,
      kept,
    })

    switch (outcome.status) {
      case 'signedOut':
        await endLocally(outcome.reason)
        return
      case 'unreachable':
        setState(outcome)
        return
      case 'signedIn':
        if (outcome.discardKept) await offline.discard()
        if (outcome.adoptKept && kept) offline.adopt(kept)
        offline.begin(outcome.user)
        setState({ status: 'signedIn', user: outcome.user, offline: outcome.offline })
        if (!outcome.offline) onConfirmed?.(outcome.user)
    }
  }, [offline, endLocally, onConfirmed])

  // Once. Every dependency of `establish` is stable in practice, but a launch that re-ran because a
  // parent passed a new callback would sign somebody in, out and in again in a loop.
  const launched = useRef(false)
  useEffect(() => {
    if (launched.current) return
    launched.current = true
    void establish()
  }, [establish])

  // The client says when a refresh was finally refused, so a session that ended while the app was
  // open does not wait for the next request to notice.
  useEffect(() => {
    onSessionChanged((tokens) => {
      if (tokens === null && current.current.status === 'signedIn') void endLocally('expired')
    })
    return () => onSessionChanged(null)
  }, [endLocally])

  const reconnect = useCallback(async () => {
    const now = current.current
    if (now.status === 'unreachable') {
      setState({ status: 'loading' })
      await establish()
      return
    }
    if (now.status !== 'signedIn' || !now.offline) return

    const answer = await whoAmI()
    if (answer.ok) {
      offline.begin(answer.user)
      setState({ status: 'signedIn', user: answer.user, offline: false })
      onConfirmed?.(answer.user)
    } else if (!answer.transient && answer.code !== 'CONTRACT_MISMATCH') {
      await endLocally('expired')
    }
  }, [establish, offline, endLocally, onConfirmed])

  // Coming back to the app is the natural moment to try again; going to the background may be
  // the last chance to write what was kept.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void reconnect()
      if (next === 'background') void offline.flush()
    })
    return () => subscription.remove()
  }, [reconnect, offline])

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null)
      try {
        const session = await auth.signIn({
          email,
          password,
          ...(deviceName ? { deviceName } : {}),
        })
        // Whatever an earlier session left behind goes before this one starts keeping anything.
        await offline.end()
        offline.begin(session.user)
        setState({ status: 'signedIn', user: session.user, offline: false })
        onConfirmed?.(session.user)
      } catch (caught) {
        setError(caught)
        throw caught
      }
    },
    [deviceName, offline, onConfirmed],
  )

  /**
   * Signing out.
   *
   * The first version awaited the server and let a failure escape — so on a phone with no signal
   * the tokens were cleared (the client does that regardless) while the screen stayed signed in,
   * with every request then failing. Now the phone is signed out whatever the network does, which
   * is what somebody about to hand their phone over needs.
   */
  const signOut = useCallback(async () => {
    const pushToken = await (pushTokenForSignOut?.() ?? Promise.resolve(null)).catch(() => null)
    try {
      await auth.signOut({ pushToken })
    } catch {
      // The client has already cleared the tokens. Nothing on this phone can use the session.
    }
    await endLocally('signedOut')
  }, [pushTokenForSignOut, endLocally])

  const value = useMemo(
    () => ({ state, lastUser: lastUser.current, signIn, signOut, reconnect, error }),
    [state, signIn, signOut, reconnect, error],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession was called outside SessionProvider.')
  return value
}

/**
 * The signed-in user, for screens behind the router's session guard.
 *
 * So screens are not each written to handle a `null` user the router has made impossible — with
 * one exception it cannot: the render in which the session ends. The guard removes the screen, but
 * the context change can reach the screen first, and throwing there crashed the app on sign-out.
 * For that render the person who was signed in is returned; the query cache has already been
 * cleared, so nothing of theirs but a name remains to show, and the screen is gone a frame later.
 */
export function useUser(): SessionUser {
  const { state, lastUser } = useSession()
  if (state.status === 'signedIn') return state.user
  if (lastUser) return lastUser
  throw new Error('useUser was called on a screen that no session has ever reached.')
}

/** Whether the session is running on kept reads, with the server out of reach. */
export function useIsOffline(): boolean {
  const { state } = useSession()
  return state.status === 'signedIn' && state.offline
}
