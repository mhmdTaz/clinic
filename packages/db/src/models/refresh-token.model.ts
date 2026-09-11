import { Schema, type Model, type InferSchemaType } from 'mongoose'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'

/**
 * One document per issued refresh token (section 10.4). Only the SHA-256 of the token
 * is stored, so a database leak cannot be replayed as live sessions.
 *
 * Tokens rotate on every refresh. Every token descending from one sign-in shares a
 * familyId — the "session" a user sees on their devices page — and presenting a token
 * that was already rotated away revokes the whole family, because that only happens
 * when a token has been copied.
 */
export const RefreshTokenSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    userId: { type: String, required: true },
    familyId: { type: String, required: true },
    tokenHash: { type: String, required: true },
    device: { name: String, userAgent: String, ipAddress: String },
    /** The original sign-in, copied onto every rotated token in the family. */
    startedAt: { type: Date, required: true },
    lastUsedAt: Date,
    expiresAt: { type: Date, required: true },
    rotatedAt: { type: Date, default: null },
    replacedById: String,
    revokedAt: { type: Date, default: null },
    revokedReason: String,
  },
  { timestamps: true, collection: 'refreshTokens' },
)

// Session rows are recorded explicitly as auth.* events rather than auto-captured:
// a refresh every 15 minutes would otherwise bury everything else in the audit log.
RefreshTokenSchema.plugin(tenantGuard)
RefreshTokenSchema.index({ tokenHash: 1 }, { unique: true })
RefreshTokenSchema.index({ clinicId: 1, userId: 1, revokedAt: 1 })
RefreshTokenSchema.index({ familyId: 1 })
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export type RefreshTokenDoc = InferSchemaType<typeof RefreshTokenSchema> & { _id: string }

export const RefreshTokenModel = (): Model<RefreshTokenDoc> =>
  getConnection().models.RefreshToken ??
  getConnection().model<RefreshTokenDoc>('RefreshToken', RefreshTokenSchema)
