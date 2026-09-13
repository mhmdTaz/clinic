import { MePermissions, SessionResult, SessionUser } from '@clinic/contracts'
import type { LoginRequest, UpdateMeRequest } from '@clinic/contracts'
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
     *
     * **A device sends its refresh token.** The first version sent an empty body and relied on the
     * access token to name the session — which works for fifteen minutes. After that the server
     * sees a lapsed token, signs the request out anonymously, and the refresh token lives on for
     * thirty days after the person believed they had signed out. The parity suite now signs out
     * with a lapsed token and then tries the old refresh token, which is the only test that can
     * tell the difference: the local tokens are gone either way.
     */
    async signOut(options: { pushToken?: string | null } = {}) {
      const held = bearer ? await client.tokens.read() : null
      try {
        await client.request('/api/v1/auth/logout', {
          method: 'POST',
          body: {
            ...(held?.refreshToken ? { refreshToken: held.refreshToken } : {}),
            // This phone stops receiving the person's notifications in the same request (§9.4).
            ...(options.pushToken ? { pushToken: options.pushToken } : {}),
          },
          skipRefresh: true,
        })
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

    /**
     * Changes the person's own details — on a phone, the portal they last chose, so the next launch
     * opens where they left off (§10.1). A device keeps using its token; the reissued one the
     * server sets as a cookie is for browsers.
     */
    updateMe(input: UpdateMeRequest) {
      return client.request('/api/v1/me', { method: 'PATCH', body: input, schema: SessionUser })
    },

    /**
     * What this person may do, with the scope of each grant. A screen uses it to decide what is
     * worth offering; the server checks again regardless (§7).
     */
    permissions() {
      return client.request('/api/v1/me/permissions', { schema: MePermissions })
    },
  }
}
