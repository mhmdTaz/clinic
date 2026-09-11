import type { SessionUser } from '@clinic/contracts'
import type { DeviceInfo } from '../../identity'

/** What the interface layer knows about the caller, from a trusted source only. */
export interface RequestMeta {
  ipAddress: string | null
  userAgent: string | null
  deviceName?: string | null
}

export interface IssuedAccessToken {
  token: string
  expiresAt: Date
}

export interface IssuedSession {
  user: SessionUser
  sessionId: string
  accessToken: string
  accessTokenExpiresAt: Date
  refreshToken: string
  refreshTokenExpiresAt: Date
}

/** Headers are caller-controlled; cap what gets stored. */
export function deviceFrom(meta: RequestMeta): DeviceInfo {
  return {
    name: meta.deviceName?.trim().slice(0, 80) || null,
    userAgent: meta.userAgent?.slice(0, 512) || null,
    ipAddress: meta.ipAddress?.slice(0, 64) || null,
  }
}
