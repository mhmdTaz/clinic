import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionUser } from '@clinic/contracts'
import { ApiError } from '@clinic/api-client'
import { auth, client, onSessionChanged } from './api'

/**
 * Who is signed in, for the whole app (§10).
 *
 * Three states, not two, and the third is the one that matters on a device: `loading` covers the
 * moment between launch and finding out whether the keychain still holds a usable session. An app
 * that assumed "no user yet" means "signed out" would flash the sign-in screen at somebody who is
 * signed in, every single launch.
 */

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut'; reason: 'never' | 'expired' | 'signedOut' }
  | { status: 'signedIn'; user: SessionUser }

interface SessionContextValue {
  state: SessionState
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  /** Set when the last sign-in attempt failed, for the form to show. */
  error: ApiError | null
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({
  children,
  onSignedOut,
}: {
  children: ReactNode
  /** Clears anything of this person's that outlives the session — the offline cache. */
  onSignedOut?: () => Promise<void>
}) {
  const [state, setState] = useState<SessionState>({ status: 'loading' })
  const [error, setError] = useState<ApiError | null>(null)

  /**
   * On launch: is there still a session in the keychain that the server honours?
   *
   * Asking the server rather than trusting the stored token, because a token can be valid on its
   * face and revoked in fact — signed out from another device, suspended, roles changed. The
   * client refreshes on the way if the access token has expired, so a person who last opened the
   * app a week ago is still signed in.
   */
  useEffect(() => {
    let cancelled = false

    void (async () => {
      const stored = await client.tokens.read()
      if (!stored) {
        if (!cancelled) setState({ status: 'signedOut', reason: 'never' })
        return
      }

      try {
        const user = await auth.me()
        if (!cancelled) setState({ status: 'signedIn', user })
      } catch (caught) {
        if (cancelled) return
        // Unreachable is not signed out: the phone may simply have no signal on launch, and
        // throwing somebody back to a sign-in screen they cannot complete is worse than waiting.
        if (caught instanceof ApiError && caught.isTransient) {
          setState({ status: 'signedOut', reason: 'never' })
        } else {
          setState({ status: 'signedOut', reason: 'expired' })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  // The client tells the app when a refresh finally failed, so a session that ended while the
  // app was open does not wait for the next request to notice.
  useEffect(() => {
    onSessionChanged((tokens) => {
      if (tokens === null) setState({ status: 'signedOut', reason: 'expired' })
    })
    return () => onSessionChanged(null)
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null)
    try {
      const session = await auth.signIn({ email, password })
      setState({ status: 'signedIn', user: session.user })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, 'UNKNOWN', 'Sign-in failed.'))
      throw caught
    }
  }, [])

  const signOut = useCallback(async () => {
    await auth.signOut()
    // The cache goes with the session. The next person to sign in on a shared phone must not see
    // the previous one's appointments while their own load.
    await onSignedOut?.()
    setState({ status: 'signedOut', reason: 'signedOut' })
  }, [onSignedOut])

  const value = useMemo(() => ({ state, signIn, signOut, error }), [state, signIn, signOut, error])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession was called outside SessionProvider.')
  return value
}

/**
 * The signed-in user, or a thrown error.
 *
 * For screens behind the auth gate, so they are not each written to handle a `null` user that
 * the router has already made impossible.
 */
export function useUser(): SessionUser {
  const { state } = useSession()
  if (state.status !== 'signedIn') {
    throw new Error('useUser was called on a screen that is not behind the sign-in gate.')
  }
  return state.user
}
