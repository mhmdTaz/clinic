import { Schema, type Model, type InferSchemaType } from 'mongoose'
import { ACTOR_TYPES, AUDIT_CATEGORIES, AUDIT_OUTCOMES, AUDIT_SEVERITIES } from '@clinic/config'
import { idField } from '../id'
import { getAuditConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'

/**
 * Registered on the AUDIT connection, never the main one (section 11.5). In production
 * that connection's user may insert and find here and do nothing else.
 *
 * No auditCapture plugin, for the obvious reason.
 */
export const AuditLogSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    occurredAt: { type: Date, required: true },

    // A full snapshot: the entry must stay readable after the user is deleted.
    actor: {
      id: String,
      type: { type: String, enum: ACTOR_TYPES, default: 'USER' },
      label: String,
      roles: [String],
    },
    impersonatorId: String,

    action: { type: String, required: true }, // "appointment.cancelled"
    category: { type: String, enum: AUDIT_CATEGORIES, required: true },
    entity: {
      type: { type: String },
      id: String,
      ids: [String],
      label: String,
    },

    before: Schema.Types.Mixed, // changed fields only, sensitive values redacted
    after: Schema.Types.Mixed,
    metadata: Schema.Types.Mixed,

    request: { id: String, ipAddress: String, userAgent: String },
    severity: { type: String, enum: AUDIT_SEVERITIES, default: 'INFO' },
    outcome: { type: String, enum: AUDIT_OUTCOMES, default: 'SUCCESS' },

    previousHash: String, // tamper-evident chain, Phase 8 (section 11.5)
    hash: String,

    expiresAt: { type: Date, required: true }, // per-document retention (section 8.13)
  },
  { collection: 'auditLogs', versionKey: false },
)

AuditLogSchema.plugin(tenantGuard)
AuditLogSchema.index({ clinicId: 1, occurredAt: -1 })
AuditLogSchema.index({ clinicId: 1, 'actor.id': 1, occurredAt: -1 })
AuditLogSchema.index({ clinicId: 1, 'entity.type': 1, 'entity.id': 1, occurredAt: -1 })
AuditLogSchema.index({ clinicId: 1, action: 1, occurredAt: -1 })
AuditLogSchema.index({ clinicId: 1, severity: 1, occurredAt: -1 })
AuditLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export type AuditLogDoc = InferSchemaType<typeof AuditLogSchema> & { _id: string }

export const AuditLogModel = (): Model<AuditLogDoc> =>
  getAuditConnection().models.AuditLog ??
  getAuditConnection().model<AuditLogDoc>('AuditLog', AuditLogSchema)
