import { SessionResult, SessionUser } from '@clinic/contracts'
import type { LoginRequest } from '@clinic/contracts'
import type { ApiClient } from '../client'
import { tokensFromSession } from '../tokens'

/**
 * Signing in and out, from either transport (section 9.1, rule 3).
 *
 * The device asks for `tokenDelivery: 'body'` and stores what comes back; the browser asks for
 * `cookie` and the server sets httpOnly cookies it can never read. One endpoint, one session
 * shape, one verification path — the difference is a single field on the request.
 */
export function authResource(client: ApiClient) {
  const bearer = client.tokens.transport === 'bearer'

  return {
    async signIn(input: Omit<LoginRequest, 'tokenDelivery'>) {
      const session = await client.request('/api/v1/auth/login', {
        method: 'POST',
        body: { ...input, tokenDelivery: bearer ? 'body' : 'cookie' },
        schema: SessionResult,
        // Signing in *is* the way to get a session; there is nothing to refresh first.
        skipRefresh: true,
      })

      if (bearer) {
        if (!session.tokens) {
          // The server honoured the request but returned no tokens, which would leave the app
          // apparently signed in and unable to call anything. Better to fail at the door.
          throw new Error('The server returned no tokens for a body delivery sign-in.')
        }
        await client.tokens.write(tokensFromSession(session.tokens))
      }

      return session
    },

    /**
     * Ends the session on the server, then locally — in that order.
     *
     * Clearing first would leave a live refresh token on the server with nothing able to revoke
     * it. If the call fails the local tokens are still cleared: somebody who pressed "sign out"
     * on a phone they are about to hand over must be signed out of *this* device regardless.
     */
    async signOut() {
      try {
        await client.request('/api/v1/auth/logout', { method: 'POST', body: {}, skipRefresh: true })
      } finally {
        await client.tokens.clear()
      }
    },

    async forgotPassword(email: string) {
      await client.request('/api/v1/auth/forgot-password', {
        method: 'POST',
        body: { email },
        skipRefresh: true,
      })
    },

    async resetPassword(input: { token: string; password: string }) {
      await client.request('/api/v1/auth/reset-password', {
        method: 'POST',
        body: input,
        skipRefresh: true,
      })
    },

    /** Who is signed in. The first call an app makes on launch, to decide what to show. */
    me() {
      return client.request('/api/v1/me', { schema: SessionUser })
    },
  }
}
