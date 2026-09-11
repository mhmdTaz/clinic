import { RefreshTokenModel } from '@clinic/db'
import type { AuthSession } from '../domain/types'

interface SessionRecord {
  _id: string
  clinicId: string
  userId: string
  familyId: string
  device?: { name?: string | null; userAgent?: string | null; ipAddress?: string | null } | null
  startedAt: Date
  lastUsedAt?: Date | null
  expiresAt: Date
  rotatedAt?: Date | null
  revokedAt?: Date | null
}

function toSession(doc: SessionRecord): AuthSession {
  return {
    id: doc._id,
    clinicId: doc.clinicId,
    userId: doc.userId,
    familyId: doc.familyId,
    deviceName: doc.device?.name ?? null,
    userAgent: doc.device?.userAgent ?? null,
    ipAddress: doc.device?.ipAddress ?? null,
    startedAt: doc.startedAt,
    lastUsedAt: doc.lastUsedAt ?? null,
    expiresAt: doc.expiresAt,
    rotatedAt: doc.rotatedAt ?? null,
    revokedAt: doc.revokedAt ?? null,
  }
}

/** A token that is live: not rotated away, not revoked, not expired. */
const live = (now: Date) => ({ rotatedAt: null, revokedAt: null, expiresAt: { $gt: now } })

export const sessionRepository = {
  async create(input: {
    id: string
    clinicId: string
    userId: string
    familyId: string
    tokenHash: string
    device: { name: string | null; userAgent: string | null; ipAddress: string | null }
    startedAt: Date
    expiresAt: Date
    now: Date
  }): Promise<AuthSession> {
    const doc = await RefreshTokenModel().create({
      _id: input.id,
      clinicId: input.clinicId,
      userId: input.userId,
      familyId: input.familyId,
      tokenHash: input.tokenHash,
      device: input.device,
      startedAt: input.startedAt,
      lastUsedAt: input.now,
      expiresAt: input.expiresAt,
    })
    return toSession(doc.toObject() as unknown as SessionRecord)
  },

  async findByHash(clinicId: string, tokenHash: string): Promise<AuthSession | null> {
    const doc = await RefreshTokenModel().findOne({ clinicId, tokenHash }).lean()
    return doc ? toSession(doc as unknown as SessionRecord) : null
  },

  async findById(clinicId: string, id: string): Promise<AuthSession | null> {
    const doc = await RefreshTokenModel().findOne({ clinicId, _id: id }).lean()
    return doc ? toSession(doc as unknown as SessionRecord) : null
  },

  /**
   * Atomic claim on a token's single rotation. When two requests present the same token
   * at once, exactly one of them gets `true`.
   */
  async claimRotation(clinicId: string, id: string, now: Date): Promise<boolean> {
    const result = await RefreshTokenModel().updateOne(
      { clinicId, _id: id, ...live(now) },
      { $set: { rotatedAt: now, lastUsedAt: now } },
    )
    return result.modifiedCount === 1
  },

  async linkReplacement(clinicId: string, id: string, replacedById: string): Promise<void> {
    await RefreshTokenModel().updateOne({ clinicId, _id: id }, { $set: { replacedById } })
  },

  async revokeFamily(clinicId: string, familyId: string, reason: string, now: Date): Promise<void> {
    await RefreshTokenModel().updateMany(
      { clinicId, familyId, revokedAt: null },
      { $set: { revokedAt: now, revokedReason: reason } },
    )
  },

  /** Every session a user has, optionally sparing the one they are using right now. */
  async revokeAllForUser(
    clinicId: string,
    userId: string,
    reason: string,
    now: Date,
    exceptFamilyId?: string,
  ): Promise<void> {
    await RefreshTokenModel().updateMany(
      {
        clinicId,
        userId,
        revokedAt: null,
        ...(exceptFamilyId ? { familyId: { $ne: exceptFamilyId } } : {}),
      },
      { $set: { revokedAt: now, revokedReason: reason } },
    )
  },

  /** Checked on every authenticated request, so signing out takes effect immediately. */
  async isFamilyActive(clinicId: string, familyId: string, now: Date): Promise<boolean> {
    return (await RefreshTokenModel().exists({ clinicId, familyId, ...live(now) })) !== null
  },

  async listLive(clinicId: string, userId: string, now: Date): Promise<AuthSession[]> {
    const docs = await RefreshTokenModel()
      .find({ clinicId, userId, ...live(now) })
      .sort({ lastUsedAt: -1, createdAt: -1 })
      .limit(100)
      .lean()
    return (docs as unknown as SessionRecord[]).map(toSession)
  },
}
