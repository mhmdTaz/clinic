import { PasswordResetTokenModel } from '@clinic/db'

export interface StoredResetToken {
  id: string
  clinicId: string
  userId: string
  expiresAt: Date
}

interface ResetRecord {
  _id: string
  clinicId: string
  userId: string
  expiresAt: Date
}

const toResetToken = (doc: ResetRecord): StoredResetToken => ({
  id: doc._id,
  clinicId: doc.clinicId,
  userId: doc.userId,
  expiresAt: doc.expiresAt,
})

const usable = (now: Date) => ({ usedAt: null, supersededAt: null, expiresAt: { $gt: now } })

export const passwordResetRepository = {
  /** Requesting a new link supersedes every earlier unused one. */
  async create(
    input: {
      id: string
      clinicId: string
      userId: string
      tokenHash: string
      requestedIp: string | null
      expiresAt: Date
    },
    now: Date,
  ): Promise<void> {
    await this.supersedeAll(input.clinicId, input.userId, now)
    await PasswordResetTokenModel().create({ _id: input.id, ...input })
  },

  async findUsableByHash(
    clinicId: string,
    tokenHash: string,
    now: Date,
  ): Promise<StoredResetToken | null> {
    const doc = await PasswordResetTokenModel()
      .findOne({ clinicId, tokenHash, ...usable(now) })
      .lean()
    return doc ? toResetToken(doc as unknown as ResetRecord) : null
  },

  /** Atomic single use: a link opened twice at once resets the password once. */
  async claim(clinicId: string, id: string, now: Date): Promise<boolean> {
    const result = await PasswordResetTokenModel().updateOne(
      { clinicId, _id: id, ...usable(now) },
      { $set: { usedAt: now } },
    )
    return result.modifiedCount === 1
  },

  async supersedeAll(clinicId: string, userId: string, now: Date): Promise<void> {
    await PasswordResetTokenModel().updateMany(
      { clinicId, userId, usedAt: null, supersededAt: null },
      { $set: { supersededAt: now } },
    )
  },
}
