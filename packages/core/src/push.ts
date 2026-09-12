import { env, processSingleton } from '@clinic/config'

/**
 * Push, through a single adapter (section 3, §9.4).
 *
 * It lives at the root beside `mailer.ts` for the same reason: two things reach for it — the
 * notifications module sends, and a future device-management screen will want to test a token —
 * and a sender one module owned would make the other import through it.
 *
 * **Expo's service, deliberately, and not APNs and FCM directly.** The app is Expo (Phase 9), so
 * one HTTPS call replaces two native SDKs, two sets of credentials and a certificate that expires
 * annually. The cost is a dependency on Expo's relay; the exchange is worth making for v1, and
 * the seam is this file — swapping in APNs/FCM later means changing `send` and nothing above it.
 */

export interface PushMessage {
  /** An Expo push token, `ExponentPushToken[...]`. */
  to: string
  title: string
  body: string
  /** Read by the app to open the right screen. Kept small: the payload limit is ~4 KB. */
  data?: Record<string, string>
  badge?: number
}

export interface PushResult {
  ok: boolean
  /** Set when the token is dead and should be removed — see `isUnregistered`. */
  error?: string
  unregistered?: boolean
}

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send'

/**
 * A token the device no longer honours: the app was uninstalled, or the token was reissued.
 *
 * Worth distinguishing from every other failure, because it is the only one where the right
 * response is to **delete the row**. Retrying it forever is how a notifications table fills with
 * addresses nobody lives at.
 */
export const isUnregistered = (detail: string | undefined): boolean =>
  detail === 'DeviceNotRegistered'

const shared = processSingleton('notifications:push', () => ({
  sender: null as ((messages: PushMessage[]) => Promise<PushResult[]>) | null,
}))

/**
 * Replaces the sender — for tests, and for a deployment that uses APNs/FCM directly.
 *
 * Pass `null` to restore the default.
 */
export function providePushSender(
  sender: ((messages: PushMessage[]) => Promise<PushResult[]>) | null,
): void {
  shared.sender = sender
}

export const push = {
  /**
   * Sends a batch.
   *
   * Batched because Expo accepts up to 100 messages per call and a clinic-wide notice is a
   * hundred devices; one call per device would be a hundred round trips for one event.
   *
   * **Never throws.** A push that failed is a notification the person will still see in the app
   * and probably by email — losing the whole delivery because a relay was briefly down would
   * turn a missing buzz into a missing message.
   */
  async send(messages: PushMessage[]): Promise<PushResult[]> {
    if (messages.length === 0) return []

    // A replaced sender is guarded exactly like the built-in one. The contract of this function
    // is "never throws", and a deployment that swapped in APNs would otherwise take every
    // notification down with it — including the in-app row that was already written.
    if (shared.sender) {
      try {
        return await shared.sender(messages)
      } catch (error) {
        return messages.map(() => ({
          ok: false,
          error: error instanceof Error ? error.message : 'PUSH_SENDER_FAILED',
        }))
      }
    }

    // No credentials configured: local development, and every test that has not installed a
    // sender. Reporting success would hide a misconfiguration in production, so it reports a
    // clear reason instead.
    if (!env().EXPO_ACCESS_TOKEN && env().NODE_ENV === 'production') {
      return messages.map(() => ({ ok: false, error: 'PUSH_NOT_CONFIGURED' }))
    }

    try {
      const response = await fetch(EXPO_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(env().EXPO_ACCESS_TOKEN
            ? { authorization: `Bearer ${env().EXPO_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(messages),
      })

      if (!response.ok) {
        return messages.map(() => ({ ok: false, error: `HTTP_${response.status}` }))
      }

      const payload = (await response.json()) as {
        data?: Array<{ status?: string; message?: string; details?: { error?: string } }>
      }

      return messages.map((_, index) => {
        const ticket = payload.data?.[index]
        if (ticket?.status === 'ok') return { ok: true }
        const detail = ticket?.details?.error
        return {
          ok: false,
          error: ticket?.message ?? detail ?? 'UNKNOWN',
          unregistered: isUnregistered(detail),
        }
      })
    } catch (error) {
      return messages.map(() => ({
        ok: false,
        error: error instanceof Error ? error.message : 'PUSH_UNREACHABLE',
      }))
    }
  },
}
