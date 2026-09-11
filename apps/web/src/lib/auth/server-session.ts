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
  | { status: 'authenticated'; actor: Actor }
  | { status: 'anonymous' | 'expired' | 'stale' | 'ended' }

/** Resolved once per request, however many layouts and pages ask for it. */
const resolveSession = cache(async (): Promise<Resolution> => {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value
  if (!token) return { status: 'anonymous' }
  try {
    const { actor, reissued } = await authenticateAccessToken(token)
    // A server component cannot set cookies. A token whose grants went stale is sent
    // through the refresh route, which can, so the browser ends up holding the new one.
    return reissued ? { status: 'stale' } : { status: 'authenticated', actor }
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

export async function requireActor(): Promise<Actor> {
  const resolution = await resolveSession()
  if (resolution.status === 'authenticated') return resolution.actor

  const next = encodeURIComponent(await currentPath())
  if (resolution.status === 'expired' || resolution.status === 'stale') {
    return redirect(`/api/v1/auth/refresh?next=${next}`)
  }
  // The signature is still valid but the session was signed out elsewhere. The cookies
  // must be cleared by a route handler, or the middleware would keep trusting them.
  if (resolution.status === 'ended') return redirect(`/api/v1/auth/session-ended?next=${next}`)
  return redirect(`/login?next=${next}`)
}

/**
 * The authoritative portal gate. A denial is recorded in the audit log with the request's
 * id and address, then the user is sent to a portal they can enter — someone who typed
 * /admin is usually lost, not attacking, but either way it is on the record.
 */
export async function requirePortal(portal: PortalKey): Promise<Actor> {
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
}
