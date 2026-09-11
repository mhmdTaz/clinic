import { UserModel } from '@clinic/db'
import type { PortalKey, UserStatus } from '@clinic/config'
import type { AuthUser } from '../domain/types'

/** Must match the unique index's collation, or the index is not used (section 8.5). */
const EMAIL_COLLATION = { locale: 'en', strength: 2 } as const

export type StoredUser = AuthUser

interface UserRecord {
  _id: string
  clinicId: string
  email: string
  firstName: string
  lastName: string
  phone?: string | null
  status: string
  passwordHash?: string | null
  roles?: Array<{ roleId: string }> | null
  preferredPortal?: string | null
  security?: { tokenVersion?: number | null; lockedUntil?: Date | null } | null
}

function toStoredUser(doc: UserRecord): StoredUser {
  return {
    id: doc._id,
    clinicId: doc.clinicId,
    email: doc.email,
    firstName: doc.firstName,
    lastName: doc.lastName,
    phone: doc.phone ?? null,
    status: doc.status as UserStatus,
    passwordHash: doc.passwordHash ?? null,
    roleIds: (doc.roles ?? []).map((role) => role.roleId),
    preferredPortal: (doc.preferredPortal ?? null) as PortalKey | null,
    tokenVersion: doc.security?.tokenVersion ?? 0,
    lockedUntil: doc.security?.lockedUntil ?? null,
  }
}

export const userRepository = {
  async findByEmail(clinicId: string, email: string): Promise<StoredUser | null> {
    const doc = await UserModel()
      .findOne({ clinicId, email: email.trim().toLowerCase() })
      .collation(EMAIL_COLLATION)
      .lean()
    return doc ? toStoredUser(doc as unknown as UserRecord) : null
  },

  async findById(clinicId: string, userId: string): Promise<StoredUser | null> {
    const doc = await UserModel().findOne({ clinicId, _id: userId }).lean()
    return doc ? toStoredUser(doc as unknown as UserRecord) : null
  },

  /**
   * One atomic pipeline update, so a burst of concurrent wrong guesses cannot undercount.
   * The previous count is forgiven when the last failure is older than `forgiveBefore`.
   * Returns the new consecutive-failure count.
   */
  async recordFailedLogin(
    clinicId: string,
    userId: string,
    now: Date,
    forgiveBefore: Date,
  ): Promise<number> {
    const doc = await UserModel()
      .findOneAndUpdate(
        { clinicId, _id: userId },
        [
          {
            $set: {
              'security.failedLoginCount': {
                $cond: [
                  {
                    $or: [
                      { $eq: [{ $ifNull: ['$security.lastFailedLoginAt', null] }, null] },
                      { $lt: ['$security.lastFailedLoginAt', forgiveBefore] },
                    ],
                  },
                  1,
                  { $add: [{ $ifNull: ['$security.failedLoginCount', 0] }, 1] },
                ],
              },
              'security.lastFailedLoginAt': now,
            },
          },
        ],
        { new: true },
      )
      .lean()
    const security = (doc as unknown as { security?: { failedLoginCount?: number } } | null)
      ?.security
    return security?.failedLoginCount ?? 1
  },

  /** Extends a lock, never shortens one that a later failure already lengthened. */
  async applyLock(clinicId: string, userId: string, lockedUntil: Date): Promise<void> {
    await UserModel().updateOne({ clinicId, _id: userId }, [
      {
        $set: {
          'security.lockedUntil': {
            $max: [{ $ifNull: ['$security.lockedUntil', lockedUntil] }, lockedUntil],
          },
        },
      },
    ])
  },

  async recordSuccessfulLogin(clinicId: string, userId: string, now: Date): Promise<void> {
    await UserModel().updateOne(
      { clinicId, _id: userId },
      {
        $set: {
          lastLoginAt: now,
          'security.failedLoginCount': 0,
          'security.lastFailedLoginAt': null,
          'security.lockedUntil': null,
        },
      },
    )
  },

  /**
   * Sets a new password hash and clears any lockout. `bumpTokenVersion` ends every
   * outstanding access token; `activate` completes an invitation.
   * Returns the resulting token version.
   */
  async setPassword(
    clinicId: string,
    userId: string,
    passwordHash: string,
    now: Date,
    options: { bumpTokenVersion: boolean; activate?: boolean },
  ): Promise<number> {
    const set: Record<string, unknown> = {
      passwordHash,
      'security.passwordChangedAt': now,
      'security.failedLoginCount': 0,
      'security.lastFailedLoginAt': null,
      'security.lockedUntil': null,
    }
    if (options.activate) {
      set.status = 'ACTIVE'
      set.emailVerifiedAt = now
    }

    const doc = await UserModel()
      .findOneAndUpdate(
        { clinicId, _id: userId },
        {
          $set: set,
          ...(options.bumpTokenVersion ? { $inc: { 'security.tokenVersion': 1 } } : {}),
        },
        { new: true },
      )
      .lean()
    return (doc as unknown as UserRecord | null)?.security?.tokenVersion ?? 0
  },

  /** A silent rehash after sign-in: same password, current parameters. */
  async replaceHash(clinicId: string, userId: string, passwordHash: string): Promise<void> {
    await UserModel().updateOne({ clinicId, _id: userId }, { $set: { passwordHash } })
  },

  async bumpTokenVersion(clinicId: string, userId: string): Promise<number> {
    const doc = await UserModel()
      .findOneAndUpdate(
        { clinicId, _id: userId },
        { $inc: { 'security.tokenVersion': 1 } },
        { new: true },
      )
      .lean()
    return (doc as unknown as UserRecord | null)?.security?.tokenVersion ?? 0
  },

  async updateProfile(
    clinicId: string,
    userId: string,
    patch: {
      firstName?: string
      lastName?: string
      phone?: string | null
      preferredPortal?: PortalKey
    },
  ): Promise<StoredUser | null> {
    const set: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(patch)) {
      if (value !== undefined) set[field] = value
    }
    const doc = await UserModel()
      .findOneAndUpdate({ clinicId, _id: userId }, { $set: set }, { new: true })
      .lean()
    return doc ? toStoredUser(doc as unknown as UserRecord) : null
  },
}
