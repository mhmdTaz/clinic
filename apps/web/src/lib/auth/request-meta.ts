import { env } from '@clinic/config'
import type { RequestMeta } from '@clinic/core/session'

/**
 * The client's address, or null when it cannot be trusted (section 10.4).
 *
 * With no proxy we control in front of the app, X-Forwarded-For is whatever the client
 * chose to send, so it is ignored: per-IP limits are skipped rather than fed a forgeable
 * value, and per-account lockout still applies. Behind a trusted proxy, X-Real-IP is
 * preferred; otherwise the LAST X-Forwarded-For hop is the address that proxy itself
 * saw — earlier hops are client-supplied.
 */
export function clientIpFrom(headers: Headers, trustProxy: boolean): string | null {
  if (!trustProxy) return null
  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp
  const hops = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean)
  return hops.at(-1) ?? null
}

export function requestMetaFrom(headers: Headers, deviceName?: string | null): RequestMeta {
  return {
    ipAddress: clientIpFrom(headers, env().TRUST_PROXY),
    userAgent: headers.get('user-agent'),
    deviceName: deviceName ?? null,
  }
}
