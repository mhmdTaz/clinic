import { Schema, type Model, type InferSchemaType } from 'mongoose'
import { PERMISSION_SCOPES } from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'

/**
 * Permission grants are EMBEDDED (section 8.5). This is the RolePermission join
 * table, gone: resolving a user's permissions becomes two indexed queries instead
 * of a three-collection join, and the permission catalogue stays in code.
 */
export const RoleSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    key: { type: String, required: true }, // "admin" | "staff" | "doctor" | "patient" | custom
    name: { type: String, required: true },
    description: String,
    isSystem: { type: Boolean, default: false }, // seeded roles cannot be deleted
    isDefault: { type: Boolean, default: false },
    priority: { type: Number, default: 0 }, // highest priority decides the landing portal

    permissions: [
      {
        _id: false,
        key: { type: String, required: true }, // "appointment:read"
        scope: { type: String, enum: PERMISSION_SCOPES, default: 'CLINIC' },
      },
    ],
  },
  { timestamps: true, collection: 'roles' },
)

RoleSchema.plugin(tenantGuard)
RoleSchema.index({ clinicId: 1, key: 1 }, { unique: true })
RoleSchema.index({ clinicId: 1, priority: -1 })

export type RoleDoc = InferSchemaType<typeof RoleSchema> & { _id: string }

export const RoleModel = (): Model<RoleDoc> =>
  getConnection().models.Role ?? getConnection().model<RoleDoc>('Role', RoleSchema)
