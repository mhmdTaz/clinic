import type { PortalKey, UserStatus } from '@clinic/config'

/** A user as authentication sees them. Never leaves the server: it carries the hash. */
export interface AuthUser {
  id: string
  clinicId: string
  email: string
  firstName: string
  lastName: string
  phone: string | null
  status: UserStatus
  passwordHash: string | null
  roleIds: string[]
  preferredPortal: PortalKey | null
  tokenVersion: number
  lockedUntil: Date | null
}

/** One issued refresh token. Tokens sharing a familyId are one signed-in device. */
export interface AuthSession {
  id: string
  clinicId: string
  userId: string
  familyId: string
  deviceName: string | null
  userAgent: string | null
  ipAddress: string | null
  /** When the family began — the original sign-in — carried through every rotation. */
  startedAt: Date
  lastUsedAt: Date | null
  expiresAt: Date
  rotatedAt: Date | null
  revokedAt: Date | null
}

export function displayNameOf(user: Pick<AuthUser, 'firstName' | 'lastName'>): string {
  return `${user.firstName} ${user.lastName}`.trim()
}
