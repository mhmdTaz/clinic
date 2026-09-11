import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { PortalKey } from '@clinic/config'
import { isDomainError, runWithContext } from '@clinic/core'
import { PORTALS, assertCan, landingPath, type Actor } from '@clinic/core/access'
import { authenticateAccessToken } from '@clinic/core/session'
import { ACCESS_COOKIE } from './cookies'
import { requestMetaFrom } from './request-meta'

type Resolution =
  | { status: 'authenticated'; actor: Actor; stale: boolean }
  | { status: 'anonymous' | 'expired' | 'ended' }

/** Resolved once per request, however many layouts and pages ask for it. */
const resolveSession = cache(async (): Promise<Resolution> => {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value
  if (!token) return { status: 'anonymous' }
  try {
    const { actor, reissued } = await authenticateAccessToken(token)
    // A token whose grants went stale still authenticates: the actor was just built from the
    // current grants, so this request is authorised correctly. A server component cannot store
    // the replacement token, so TokenRenewal has an API route do it from the browser. Sending
    // the browser through the refresh route instead looped: the client router replays a
    // redirect met during a refresh or a soft navigation, and never settles.
    return { status: 'authenticated', actor, stale: reissued !== null }
  } catch (error) {
    if (isDomainError(error) && error.code === 'TOKEN_EXPIRED') return { status: 'expired' }
    if (isDomainError(error) && error.code === 'UNAUTHENTICATED') return { status: 'ended' }
    throw error
  }
})

async function currentPath(): Promise<string> {
  return (await headers()).get('x-pathname') ?? '/'
}

export async function optionalActor(): Promise<Actor | null> {
  const resolution = await resolveSession()
  return resolution.status === 'authenticated' ? resolution.actor : null
}

/** True when this request was authorised with outdated grants whose token should be replaced. */
export async function accessTokenIsStale(): Promise<boolean> {
  const resolution = await resolveSession()
  return resolution.status === 'authenticated' && resolution.stale
}

export async function requireActor(): Promise<Actor> {
  const resolution = await resolveSession()
  if (resolution.status === 'authenticated') return resolution.actor

  const next = encodeURIComponent(await currentPath())
  // The middleware renews an expired token before the page renders; this covers a token that
  // expired in between.
  if (resolution.status === 'expired') return redirect(`/api/v1/auth/refresh?next=${next}`)
  // The signature is still valid but the session was signed out elsewhere. The cookies
  // must be cleared by a route handler, or the middleware would keep trusting them.
  if (resolution.status === 'ended') return redirect(`/api/v1/auth/session-ended?next=${next}`)
  return redirect(`/login?next=${next}`)
}

/**
 * The authoritative portal gate. A denial is recorded in the audit log with the request's
 * id and address, then the user is sent to a portal they can enter — someone who typed
 * /admin is usually lost, not attacking, but either way it is on the record.
 *
 * Portal pages call this too, not requireActor: Next.js renders a layout and its page at the
 * same time, so a page that only required an actor would run its own permission checks while
 * the layout was still deciding to redirect — and each refusal there writes a second,
 * misleading permission.denied. Memoised per request, so the layout and the page share one
 * check: one redirect, one audit entry.
 */
export const requirePortal = cache(async (portal: PortalKey): Promise<Actor> => {
  const actor = await requireActor()
  const requestHeaders = await headers()
  const meta = requestMetaFrom(requestHeaders)

  try {
    await runWithContext(
      {
        requestId: requestHeaders.get('x-request-id') ?? crypto.randomUUID(),
        actorId: actor.userId,
        actorType: actor.kind,
        actorLabel: actor.displayName,
        actorRoles: actor.roleKeys,
        clinicId: actor.clinicId,
        ipAddress: meta.ipAddress ?? undefined,
        userAgent: meta.userAgent ?? undefined,
      },
      () => assertCan(actor, PORTALS[portal].permission),
    )
  } catch (error) {
    if (isDomainError(error) && error.code === 'FORBIDDEN') {
      return redirect(landingPath(actor.portals, actor.preferredPortal))
    }
    throw error
  }
  return actor
})
