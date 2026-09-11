import { Schema, type Model, type InferSchemaType } from 'mongoose'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'

/**
 * An activation link for an account staff already created (ADR-0006). Accepting it
 * sets the first password and makes the account ACTIVE; it never creates a user, so a
 * leaked link cannot mint new accounts.
 */
export const InvitationSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    userId: { type: String, required: true },
    email: { type: String, required: true },
    tokenHash: { type: String, required: true },
    invitedBy: { id: String, name: String },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'invitations' },
)

InvitationSchema.plugin(tenantGuard)
InvitationSchema.index({ tokenHash: 1 }, { unique: true })
InvitationSchema.index({ clinicId: 1, userId: 1, acceptedAt: 1 })
InvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export type InvitationDoc = InferSchemaType<typeof InvitationSchema> & { _id: string }

export const InvitationModel = (): Model<InvitationDoc> =>
  getConnection().models.Invitation ??
  getConnection().model<InvitationDoc>('Invitation', InvitationSchema)
