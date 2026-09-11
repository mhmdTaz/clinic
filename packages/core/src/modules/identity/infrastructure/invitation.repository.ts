import { InvitationModel } from '@clinic/db'

export interface StoredInvitation {
  id: string
  clinicId: string
  userId: string
  email: string
  expiresAt: Date
}

interface InvitationRecord {
  _id: string
  clinicId: string
  userId: string
  email: string
  expiresAt: Date
}

const toInvitation = (doc: InvitationRecord): StoredInvitation => ({
  id: doc._id,
  clinicId: doc.clinicId,
  userId: doc.userId,
  email: doc.email,
  expiresAt: doc.expiresAt,
})

const usable = (now: Date) => ({ acceptedAt: null, revokedAt: null, expiresAt: { $gt: now } })

export const invitationRepository = {
  /** Only the newest link works: earlier unaccepted invitations for this user are revoked. */
  async create(
    input: {
      id: string
      clinicId: string
      userId: string
      email: string
      tokenHash: string
      invitedBy: { id: string; name: string }
      expiresAt: Date
    },
    now: Date,
  ): Promise<StoredInvitation> {
    await InvitationModel().updateMany(
      { clinicId: input.clinicId, userId: input.userId, acceptedAt: null, revokedAt: null },
      { $set: { revokedAt: now } },
    )
    const doc = await InvitationModel().create({ _id: input.id, ...input })
    return toInvitation(doc.toObject() as unknown as InvitationRecord)
  },

  async findUsableByHash(
    clinicId: string,
    tokenHash: string,
    now: Date,
  ): Promise<StoredInvitation | null> {
    const doc = await InvitationModel()
      .findOne({ clinicId, tokenHash, ...usable(now) })
      .lean()
    return doc ? toInvitation(doc as unknown as InvitationRecord) : null
  },

  /** Every link still waiting for this user stops working: suspension, or a changed address. */
  async revokeForUser(clinicId: string, userId: string, now: Date): Promise<void> {
    await InvitationModel().updateMany(
      { clinicId, userId, acceptedAt: null, revokedAt: null },
      { $set: { revokedAt: now } },
    )
  },

  /** The newest link that still works, for "invitation sent … expires …". */
  async findLatestUsable(
    clinicId: string,
    userId: string,
    now: Date,
  ): Promise<{ sentAt: Date; expiresAt: Date } | null> {
    const doc = (await InvitationModel()
      .findOne({ clinicId, userId, ...usable(now) })
      .sort({ createdAt: -1 })
      .lean()) as unknown as (InvitationRecord & { createdAt?: Date | null }) | null
    return doc ? { sentAt: doc.createdAt ?? now, expiresAt: doc.expiresAt } : null
  },

  /** Atomic: a link submitted from two tabs at once activates the account exactly once. */
  async claim(clinicId: string, id: string, now: Date): Promise<boolean> {
    const result = await InvitationModel().updateOne(
      { clinicId, _id: id, ...usable(now) },
      { $set: { acceptedAt: now } },
    )
    return result.modifiedCount === 1
  },
}
