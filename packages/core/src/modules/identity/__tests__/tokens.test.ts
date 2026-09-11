import { describe, expect, it } from 'vitest'
import {
  generateOpaqueToken,
  hashOpaqueToken,
  signAccessToken,
  verifyAccessToken,
  type AccessTokenClaims,
} from '../domain/tokens'

const SECRET = 'integration-secret-that-is-long-enough-000'
const T0 = new Date('2026-09-11T10:00:00Z')

const claims: AccessTokenClaims = {
  sub: 'u1',
  cid: 'c1',
  sid: 's1',
  tv: 0,
  pv: 3,
  name: 'Sara Karam',
  rls: ['patient'],
  prm: { 'portal.patient:access': 'C', 'patient:read': 'O' },
  prt: ['patient'],
  pp: null,
}

const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000)
const base64Url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

describe('access tokens', () => {
  it('round-trips the claims and reports the expiry', async () => {
    const { token, expiresAt } = await signAccessToken(claims, SECRET, 900, T0)
    const result = await verifyAccessToken(token, SECRET, later(60))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.claims).toEqual(claims)
    expect(result.expiresAt.toISOString()).toBe(expiresAt.toISOString())
    expect(expiresAt.toISOString()).toBe('2026-09-11T10:15:00.000Z')
  })

  it('reports EXPIRED, distinct from INVALID, once the lifetime is over', async () => {
    const { token } = await signAccessToken(claims, SECRET, 60, T0)
    expect(await verifyAccessToken(token, SECRET, later(70))).toEqual({
      ok: false,
      reason: 'EXPIRED',
    })
  })

  it('allows a few seconds of clock drift between servers', async () => {
    const { token } = await signAccessToken(claims, SECRET, 60, T0)
    expect((await verifyAccessToken(token, SECRET, later(63))).ok).toBe(true)
  })

  it('rejects a token signed with a different secret', async () => {
    const { token } = await signAccessToken(
      claims,
      'another-secret-that-is-long-enough-111',
      900,
      T0,
    )
    expect(await verifyAccessToken(token, SECRET, T0)).toEqual({ ok: false, reason: 'INVALID' })
  })

  it('rejects a token whose payload was edited', async () => {
    const { token } = await signAccessToken(claims, SECRET, 900, T0)
    const [header, , signature] = token.split('.')
    const forged = base64Url({ ...claims, prm: { 'audit:read': 'G' } })
    expect(await verifyAccessToken(`${header}.${forged}.${signature}`, SECRET, T0)).toEqual({
      ok: false,
      reason: 'INVALID',
    })
  })

  it('rejects an unsigned "alg: none" token outright', async () => {
    const exp = Math.floor(later(900).getTime() / 1000)
    const unsigned = `${base64Url({ alg: 'none', typ: 'JWT' })}.${base64Url({
      ...claims,
      iss: 'clinic-platform',
      aud: 'clinic-api',
      exp,
    })}.`
    expect(await verifyAccessToken(unsigned, SECRET, T0)).toEqual({ ok: false, reason: 'INVALID' })
  })

  it('rejects a correctly signed token whose claims do not match the schema', async () => {
    const malformed = { ...claims, prm: { 'patient:read': 'Z' } } as unknown as AccessTokenClaims
    const { token } = await signAccessToken(malformed, SECRET, 900, T0)
    expect(await verifyAccessToken(token, SECRET, T0)).toEqual({ ok: false, reason: 'INVALID' })
  })

  it('rejects garbage', async () => {
    expect(await verifyAccessToken('not-a-jwt', SECRET, T0)).toEqual({
      ok: false,
      reason: 'INVALID',
    })
  })
})

describe('opaque tokens', () => {
  it('carries 256 bits as 43 URL-safe characters', () => {
    const token = generateOpaqueToken()
    expect(token).toHaveLength(43)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateOpaqueToken()))
    expect(tokens.size).toBe(1000)
  })

  it('hashes to 64 hex characters, deterministically, and differently per token', async () => {
    const token = generateOpaqueToken()
    const hash = await hashOpaqueToken(token)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashOpaqueToken(token)).toBe(hash)
    expect(await hashOpaqueToken(generateOpaqueToken())).not.toBe(hash)
  })
})
