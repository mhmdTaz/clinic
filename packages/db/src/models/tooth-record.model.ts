import { Schema, type InferSchemaType, type Model } from 'mongoose'
import {
  DENTAL_SCOPES,
  DENTAL_SYMBOLS,
  TOOTH_RECORD_STATUSES,
  TOOTH_ROLES,
  TOOTH_SURFACES,
} from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { softDelete } from '../plugins/soft-delete'
import { auditCapture } from '../plugins/audit-capture'

const PersonRefSchema = new Schema({ id: String, name: String }, { _id: false })

/**
 * One thing charted on one or more teeth (Phase 11, ADR-0035).
 *
 * The tooth chart is an event log, not a picture that is repainted. Every crown, filling and
 * finding is its own row and is never edited afterwards; what a tooth looks like today is worked
 * out from its rows. That is what lets the chart answer "what was done to 16, and when" — the
 * question the whole feature exists for — and what lets it be replayed as it stood on any day.
 *
 * A mistake is voided with a reason, not changed or deleted, for the same reason a signed note
 * takes an addendum (ADR-0024). Finishing planned work writes a new COMPLETED row that points at
 * the plan through `completesRecordId`, so the plan and its completion are both on the record.
 *
 * `teeth` holds one tooth for most work. A bridge names its abutments and its pontic; a denture
 * names the teeth it replaces. It is bounded by a jaw: sixteen teeth at most.
 */
export const ToothRecordSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    patientId: { type: String, required: true },
    /** The visit it was done in. Null for work found or done elsewhere, charted at intake. */
    encounterId: { type: String, default: null },

    teeth: [
      {
        _id: false,
        /** FDI two-digit notation: 11–48 permanent, 51–85 primary (ISO 3950). */
        fdi: { type: String, required: true },
        role: { type: String, enum: [...TOOTH_ROLES, null], default: null },
      },
    ],
    surfaces: { type: [{ type: String, enum: TOOTH_SURFACES }], default: [] },

    treatmentId: { type: String, required: true },
    /** Copied when charted, so renaming or retiring a treatment never restates the history. */
    treatment: {
      code: { type: String, required: true },
      name: { type: String, required: true },
      symbol: { type: String, enum: DENTAL_SYMBOLS, required: true },
      scope: { type: String, enum: DENTAL_SCOPES, required: true },
    },

    status: { type: String, enum: TOOTH_RECORD_STATUSES, required: true },
    /** The PLANNED row this COMPLETED row carries out. */
    completesRecordId: { type: String, default: null },

    notes: { type: String, default: null },
    /** A calendar date in the clinic's zone: "done on the 26th" has no clock (ADR-0010). */
    performedOn: { type: String, required: true },
    /** Who did the work. Null for EXISTING work another dentist did. */
    doctor: { type: PersonRefSchema, default: null },
    doctorId: { type: String, default: null },
    /** Who typed it in — often the front desk after the visit, which is the point. */
    recordedBy: { type: PersonRefSchema, default: null },

    voidedAt: { type: Date, default: null },
    voidedBy: { type: PersonRefSchema, default: null },
    voidReason: { type: String, default: null },
  },
  { timestamps: true, collection: 'tooth_records' },
)

ToothRecordSchema.plugin(tenantGuard)
ToothRecordSchema.plugin(softDelete)
// The chart is PHI: every read is on the record, as for a visit (11.3).
ToothRecordSchema.plugin(auditCapture, { model: 'ToothRecord', phiRead: true })

ToothRecordSchema.index({ clinicId: 1, patientId: 1, performedOn: 1, createdAt: 1 }) // the chart
ToothRecordSchema.index({ clinicId: 1, patientId: 1, 'teeth.fdi': 1 }) // one tooth's timeline
ToothRecordSchema.index({ clinicId: 1, encounterId: 1 }, { sparse: true }) // "this visit"
ToothRecordSchema.index({ clinicId: 1, status: 1, performedOn: 1 }) // plans left undone (Phase 12)

export type ToothRecordDoc = InferSchemaType<typeof ToothRecordSchema> & { _id: string }

export const ToothRecordModel = (): Model<ToothRecordDoc> =>
  getConnection().models.ToothRecord ??
  getConnection().model<ToothRecordDoc>('ToothRecord', ToothRecordSchema)
