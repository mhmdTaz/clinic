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
    /**
     * Position in the clinic's chain, assigned when the link is claimed.
     *
     * The chain's order is the order links were **claimed**, which is not the order entries were
     * timestamped: `occurredAt` is stamped at the call site and the claim happens later, so two
     * concurrent writes can claim in the opposite order to their timestamps. Verifying by
     * `occurredAt` would then report tampering that never happened.
     */
    chainSeq: Number,

    expiresAt: { type: Date, required: true }, // per-document retention (section 8.13)
  },
  {
    collection: 'auditLogs',
    versionKey: false,
    /**
     * **The log stores exactly what it was given.**
     *
     * Mongoose's `minimize` silently drops empty objects on save, so a diff recording
     * `settings: {}` would be hashed with that field and stored without it — and every such entry
     * would then fail verification, a false tamper alarm caused entirely by the ORM. Beyond the
     * chain it is also just wrong: "this field was set to an empty object" is a real change, and
     * an audit log that quietly discards it is not recording what happened.
     */
    minimize: false,
  },
)

AuditLogSchema.plugin(tenantGuard)
AuditLogSchema.index({ clinicId: 1, occurredAt: -1 })
AuditLogSchema.index({ clinicId: 1, 'actor.id': 1, occurredAt: -1 })
AuditLogSchema.index({ clinicId: 1, 'entity.type': 1, 'entity.id': 1, occurredAt: -1 })
AuditLogSchema.index({ clinicId: 1, action: 1, occurredAt: -1 })
AuditLogSchema.index({ clinicId: 1, severity: 1, occurredAt: -1 })
AuditLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
/**
 * The verifier's walk: true chain order, unique so a duplicated position cannot enter the log.
 *
 * Partial rather than sparse — a compound sparse index only skips documents missing *every* key,
 * and `clinicId` is always there, so pre-chain entries would all index as null and collide.
 */
AuditLogSchema.index(
  { clinicId: 1, chainSeq: 1 },
  { unique: true, partialFilterExpression: { chainSeq: { $exists: true } } },
)

export type AuditLogDoc = InferSchemaType<typeof AuditLogSchema> & { _id: string }

export const AuditLogModel = (): Model<AuditLogDoc> =>
  getAuditConnection().models.AuditLog ??
  getAuditConnection().model<AuditLogDoc>('AuditLog', AuditLogSchema)

/**
 * Where each clinic's audit chain currently ends (section 11.5).
 *
 * One document per clinic, advanced by compare-and-swap so two concurrent audit writes cannot
 * both claim the same predecessor. It lives on the **audit connection** with the log itself: the
 * restricted role that may insert into `auditLogs` is the only thing that should be able to move
 * the head either, and a head an application could rewrite would make the chain worth nothing.
 */
export const AuditChainHeadSchema = new Schema(
  {
    _id: { type: String, required: true },
    hash: { type: String, required: true },
    /** The entry this hash belongs to — what a repair would need to know. */
    entryId: { type: String, default: null },
    /** How many links the chain holds. The next claim takes `seq + 1`. */
    seq: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now },

    /**
     * Where the nightly verifier got to (section 11.5).
     *
     * A **bookmark, not evidence**: it lets the job resume instead of re-walking seven years
     * every night. Anyone who could forge it could already move the head, so it proves nothing on
     * its own — which is why a full walk from genesis still runs weekly and on demand.
     */
    verifiedAt: { type: Date, default: null },
    verifiedHash: { type: String, default: null },
    /** The chain position the verifier reached, so the next run resumes exactly there. */
    verifiedSeq: { type: Number, default: 0 },
    fullyVerifiedAt: { type: Date, default: null },
  },
  { collection: 'auditChainHeads', versionKey: false },
)

export type AuditChainHeadDoc = InferSchemaType<typeof AuditChainHeadSchema> & { _id: string }

export const AuditChainHeadModel = (): Model<AuditChainHeadDoc> =>
  getAuditConnection().models.AuditChainHead ??
  getAuditConnection().model<AuditChainHeadDoc>('AuditChainHead', AuditChainHeadSchema)
