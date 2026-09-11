import { Schema, type Model, type InferSchemaType } from 'mongoose'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'

/**
 * Single-use, short-lived, hash-only (section 10.4). Requesting a new link supersedes
 * any earlier unused one, so only the most recent email ever works.
 */
export const PasswordResetTokenSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    userId: { type: String, required: true },
    tokenHash: { type: String, required: true },
    requestedIp: String,
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    supersededAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'passwordResetTokens' },
)

PasswordResetTokenSchema.plugin(tenantGuard)
PasswordResetTokenSchema.index({ tokenHash: 1 }, { unique: true })
PasswordResetTokenSchema.index({ clinicId: 1, userId: 1, usedAt: 1 })
PasswordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export type PasswordResetTokenDoc = InferSchemaType<typeof PasswordResetTokenSchema> & {
  _id: string
}

export const PasswordResetTokenModel = (): Model<PasswordResetTokenDoc> =>
  getConnection().models.PasswordResetToken ??
  getConnection().model<PasswordResetTokenDoc>('PasswordResetToken', PasswordResetTokenSchema)
