import { SignJWT, errors as joseErrors, jwtVerify } from 'jose'
import { z } from 'zod'
import { PORTAL_KEYS } from '@clinic/config'

/**
 * Session tokens (sections 9.1 and 10.3).
 *
 * The access token is a short-lived HS256 JWT. The web app keeps it in an httpOnly
 * cookie and the mobile app sends the identical token as a Bearer header — one
 * verification path, one session shape.
 *
 * This file uses only jose and Web Crypto, with no driver or Node-only imports, so
 * the middleware can verify a token without pulling in the database.
 */
const ISSUER = 'clinic-platform'
const AUDIENCE = 'clinic-api'

const PortalKeySchema = z.enum(PORTAL_KEYS)

export const AccessTokenClaimsSchema = z.object({
  /** user id */
  sub: z.string().min(1),
  /** clinic id */
  cid: z.string().min(1),
  /** session (refresh-token family) id — revoking the family ends this token too */
  sid: z.string().min(1),
  /** user.security.tokenVersion at issue time */
  tv: z.number().int().nonnegative(),
  /** clinic.permissionVersion at issue time (section 7.7) */
  pv: z.number().int().positive(),
  name: z.string(),
  rls: z.array(z.string()),
  /** permission key -> scope code (O / A / C / G) */
  prm: z.record(z.string(), z.enum(['O', 'A', 'C', 'G'])),
  /** portals, most relevant first */
  prt: z.array(PortalKeySchema),
  pp: PortalKeySchema.nullable(),
  did: z.string().optional(),
  pid: z.string().optional(),
  imp: z.string().optional(),
})

export type AccessTokenClaims = z.infer<typeof AccessTokenClaimsSchema>

export type TokenVerification =
  | { ok: true; claims: AccessTokenClaims; expiresAt: Date }
  | { ok: false; reason: 'EXPIRED' | 'INVALID' }

const encoder = new TextEncoder()

async function sha256(input: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(input)))
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

const keyCache = new Map<string, Promise<Uint8Array>>()

/**
 * Derived with a context label rather than using AUTH_SECRET raw, so the same secret
 * can never produce an identical key for some other purpose added later.
 */
function signingKey(secret: string): Promise<Uint8Array> {
  let key = keyCache.get(secret)
  if (!key) {
    key = sha256(`clinic:access-token:v1:${secret}`)
    keyCache.set(secret, key)
  }
  return key
}

export async function signAccessToken(
  claims: AccessTokenClaims,
  secret: string,
  ttlSeconds: number,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const issuedAt = Math.floor(now.getTime() / 1000)
  const expiresAt = issuedAt + ttlSeconds

  const token = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.sub)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .setJti(generateOpaqueToken(16))
    .sign(await signingKey(secret))

  return { token, expiresAt: new Date(expiresAt * 1000) }
}

export async function verifyAccessToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): Promise<TokenVerification> {
  try {
    const { payload } = await jwtVerify(token, await signingKey(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      // Pinned: a token claiming "alg: none" or an asymmetric algorithm is rejected
      // outright rather than trusted.
      algorithms: ['HS256'],
      currentDate: now,
      clockTolerance: 5,
    })
    const parsed = AccessTokenClaimsSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, reason: 'INVALID' }
    return { ok: true, claims: parsed.data, expiresAt: new Date((payload.exp ?? 0) * 1000) }
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) return { ok: false, reason: 'EXPIRED' }
    return { ok: false, reason: 'INVALID' }
  }
}

/** Refresh tokens, reset links and invitation links: 256 bits of randomness, URL-safe. */
export function generateOpaqueToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return toBase64Url(buffer)
}

/** Only this hash is ever stored. A leaked database cannot be replayed as sessions. */
export async function hashOpaqueToken(token: string): Promise<string> {
  return toHex(await sha256(token))
}
