import { Schema, type Model, type InferSchemaType } from 'mongoose'
import { PORTAL_KEYS, USER_STATUSES } from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { softDelete } from '../plugins/soft-delete'
import { auditCapture } from '../plugins/audit-capture'

export const UserSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: String,
    passwordHash: String, // null while an invite is pending
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    avatarFileId: String,
    locale: String,

    // Embedded assignments; the role definition itself is shared and referenced.
    roles: [
      {
        _id: false,
        roleId: { type: String, required: true },
        branchId: String,
        assignedAt: { type: Date, default: Date.now },
        assignedBy: String,
      },
    ],

    status: { type: String, enum: USER_STATUSES, default: 'INVITED' },
    emailVerifiedAt: Date,
    lastLoginAt: Date,
    security: {
      failedLoginCount: { type: Number, default: 0 },
      lastFailedLoginAt: Date,
      lockedUntil: Date,
      /**
       * Bumped on a password change, a reset, and "sign out everywhere". Every access
       * token carries the value it was issued with, so one bump ends them all.
       */
      tokenVersion: { type: Number, default: 0 },
      passwordChangedAt: Date,
      mfaSecretEncrypted: String, // CSFLE in production (section 16.1)
      mfaEnabledAt: Date,
      mustChangePassword: { type: Boolean, default: false },
    },
    preferredPortal: { type: String, enum: PORTAL_KEYS },
  },
  { timestamps: true, collection: 'users' },
)

UserSchema.plugin(tenantGuard)
UserSchema.plugin(softDelete)
UserSchema.plugin(auditCapture, {
  model: 'User',
  // The change is recorded; the value never is.
  sensitivePaths: ['passwordHash', 'security.mfaSecretEncrypted'],
  // Churn on every sign-in attempt. The explicit auth.* events already say what happened.
  ignoredPaths: [
    'lastLoginAt',
    'security.failedLoginCount',
    'security.lastFailedLoginAt',
    'security.lockedUntil',
  ],
})

/**
 * Case-insensitive uniqueness, scoped per clinic, ignoring soft-deleted users.
 *
 *  - the collation makes Sara@x.com and sara@x.com collide; queries must use the
 *    same collation or the index is not used, so the repository sets it once.
 *  - partialFilterExpression is what makes unique-plus-soft-delete work at all.
 */
UserSchema.index(
  { clinicId: 1, email: 1 },
  {
    unique: true,
    collation: { locale: 'en', strength: 2 },
    partialFilterExpression: { deletedAt: null },
  },
)
UserSchema.index({ clinicId: 1, status: 1 })
UserSchema.index({ 'roles.roleId': 1 }) // multikey: "who holds this role"

export type UserDoc = InferSchemaType<typeof UserSchema> & { _id: string }

export const UserModel = (): Model<UserDoc> =>
  getConnection().models.User ?? getConnection().model<UserDoc>('User', UserSchema)
