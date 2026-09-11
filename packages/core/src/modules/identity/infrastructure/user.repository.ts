import { UserModel, newId } from '@clinic/db'
import { emailKey, escapeRegex, nameKey, type PortalKey, type UserStatus } from '@clinic/config'
import { ConflictError } from '../../../errors'
import { afterCursor, decodeCursor, encodeCursor, type Page } from '../../../pagination'
import { sessionOf, type Transaction } from '../../../transaction'
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
  roles?: Array<{ roleId: string; assignedAt?: Date | null; assignedBy?: string | null }> | null
  preferredPortal?: string | null
  security?: { tokenVersion?: number | null; lockedUntil?: Date | null } | null
  emailVerifiedAt?: Date | null
  lastLoginAt?: Date | null
  createdAt?: Date | null
  search?: { firstName?: string | null; lastName?: string | null } | null
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
    emailVerifiedAt: doc.emailVerifiedAt ?? null,
    lastLoginAt: doc.lastLoginAt ?? null,
    createdAt: doc.createdAt ?? null,
  }
}

const isDuplicateKey = (error: unknown) => (error as { code?: unknown } | null)?.code === 11000

const emailTaken = () =>
  new ConflictError('EMAIL_TAKEN', 'Another account already uses this email address.', [
    { field: 'email', issue: 'EMAIL_TAKEN' },
  ])

export interface UserListFilter {
  q?: string
  status?: UserStatus
  roleId?: string
  limit: number
  cursor?: string
}

const SORT_FIELDS = ['search.lastName', 'search.firstName', '_id'] as const

/** Anchored and case-sensitive against the folded keys, so the index serves it. */
const startsWith = (value: string) => ({ $regex: `^${escapeRegex(value)}` })

/**
 * "sara", "karam", "sara karam", "karam sara" and "sara@clin" all find Sara Karam. An address
 * searches emails only; anything else tries names, whole and split, and the email's start.
 */
function searchFilter(q: string): Record<string, unknown> | null {
  if (q.includes('@')) {
    const key = emailKey(q)
    return key ? { 'search.email': startsWith(key) } : null
  }
  const full = nameKey(q)
  if (!full) return null
  const branches: Array<Record<string, unknown>> = [
    { 'search.lastName': startsWith(full) },
    { 'search.firstName': startsWith(full) },
    { 'search.email': startsWith(full) },
  ]
  const [first, ...rest] = full.split(' ')
  if (first && rest.length > 0) {
    const remainder = rest.join(' ')
    branches.push({
      'search.firstName': startsWith(first),
      'search.lastName': startsWith(remainder),
    })
    branches.push({
      'search.lastName': startsWith(first),
      'search.firstName': startsWith(remainder),
    })
  }
  return { $or: branches }
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

  async findManyByIds(clinicId: string, ids: readonly string[]): Promise<StoredUser[]> {
    if (ids.length === 0) return []
    const docs = await UserModel()
      .find({ clinicId, _id: { $in: [...ids] } })
      .lean()
    return (docs as unknown as UserRecord[]).map(toStoredUser)
  },

  /** A page of the user directory, in name order. */
  async list(clinicId: string, filter: UserListFilter): Promise<Page<StoredUser>> {
    const query: Record<string, unknown> = { clinicId }
    if (filter.status) query.status = filter.status
    if (filter.roleId) query['roles.roleId'] = filter.roleId

    const conditions: Array<Record<string, unknown>> = []
    const search = filter.q ? searchFilter(filter.q) : null
    if (search) conditions.push(search)
    if (filter.cursor) conditions.push(afterCursor(SORT_FIELDS, decodeCursor(filter.cursor, 3)))
    if (conditions.length > 0) query.$and = conditions

    const docs = (await UserModel()
      .find(query)
      .sort({ 'search.lastName': 1, 'search.firstName': 1, _id: 1 })
      .limit(filter.limit + 1)
      .lean()) as unknown as UserRecord[]

    const page = docs.slice(0, filter.limit)
    const last = page.at(-1)
    return {
      items: page.map(toStoredUser),
      nextCursor:
        docs.length > filter.limit && last
          ? encodeCursor([last.search?.lastName ?? null, last.search?.firstName ?? null, last._id])
          : null,
    }
  },

  /** A new account waiting for activation (ADR-0006). No password until the invitation is used. */
  async create(
    input: {
      clinicId: string
      email: string
      firstName: string
      lastName: string
      phone: string | null
      roles: ReadonlyArray<{ roleId: string; assignedBy: string | null }>
    },
    now: Date,
    tx?: Transaction,
  ): Promise<StoredUser> {
    try {
      const [doc] = await UserModel().create(
        [
          {
            _id: newId(),
            clinicId: input.clinicId,
            email: input.email.trim().toLowerCase(),
            firstName: input.firstName,
            lastName: input.lastName,
            phone: input.phone,
            status: 'INVITED',
            roles: input.roles.map((role) => ({
              roleId: role.roleId,
              assignedAt: now,
              assignedBy: role.assignedBy,
            })),
            deletedAt: null,
          },
        ],
        { session: sessionOf(tx) },
      )
      if (!doc) throw new Error('The user document was not created')
      return toStoredUser(doc.toObject() as unknown as UserRecord)
    } catch (error) {
      if (isDuplicateKey(error)) throw emailTaken()
      throw error
    }
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

  /** A forced reset: the old password stops working before the new one is chosen. */
  async clearPassword(clinicId: string, userId: string): Promise<void> {
    await UserModel().updateOne({ clinicId, _id: userId }, { $set: { passwordHash: null } })
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

  /** Administrative edits: name and phone always, the email only when the caller allows it. */
  async updateDetails(
    clinicId: string,
    userId: string,
    patch: { firstName: string; lastName: string; phone: string | null; email?: string },
    tx?: Transaction,
  ): Promise<StoredUser | null> {
    const set: Record<string, unknown> = {
      firstName: patch.firstName,
      lastName: patch.lastName,
      phone: patch.phone,
    }
    if (patch.email) set.email = patch.email.trim().toLowerCase()
    try {
      const doc = await UserModel()
        .findOneAndUpdate(
          { clinicId, _id: userId },
          { $set: set },
          { new: true, session: sessionOf(tx) },
        )
        .lean()
      return doc ? toStoredUser(doc as unknown as UserRecord) : null
    } catch (error) {
      if (isDuplicateKey(error)) throw emailTaken()
      throw error
    }
  },

  async setStatus(
    clinicId: string,
    userId: string,
    status: UserStatus,
  ): Promise<StoredUser | null> {
    const doc = await UserModel()
      .findOneAndUpdate({ clinicId, _id: userId }, { $set: { status } }, { new: true })
      .lean()
    return doc ? toStoredUser(doc as unknown as UserRecord) : null
  },

  /** Replaces the roles, keeping when and by whom each role that stays was first assigned. */
  async setRoles(
    clinicId: string,
    userId: string,
    roleIds: readonly string[],
    assignment: { assignedBy: string | null; now: Date },
    tx?: Transaction,
  ): Promise<StoredUser | null> {
    const session = sessionOf(tx)
    const current = (await UserModel()
      .findOne({ clinicId, _id: userId })
      .select({ roles: 1 })
      .session(session ?? null)
      .lean()) as unknown as UserRecord | null
    if (!current) return null

    const kept = new Map((current.roles ?? []).map((role) => [role.roleId, role]))
    const roles = roleIds.map((roleId) => {
      const existing = kept.get(roleId)
      return existing
        ? {
            roleId,
            assignedAt: existing.assignedAt ?? assignment.now,
            assignedBy: existing.assignedBy ?? null,
          }
        : { roleId, assignedAt: assignment.now, assignedBy: assignment.assignedBy }
    })

    const doc = await UserModel()
      .findOneAndUpdate({ clinicId, _id: userId }, { $set: { roles } }, { new: true, session })
      .lean()
    return doc ? toStoredUser(doc as unknown as UserRecord) : null
  },
}
