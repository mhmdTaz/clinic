import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { DENTAL_SYMBOLS, LAB_ORDER_STATUSES } from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { softDelete } from '../plugins/soft-delete'
import { auditCapture } from '../plugins/audit-capture'

const PersonRefSchema = new Schema({ id: String, name: String }, { _id: false })

/**
 * Lab work sent out for a tooth (Phase 13): a crown, a bridge, a denture, made by a dental lab.
 *
 * It points at the chart rows it is made for, and copies the teeth and the work so the lab board
 * reads without opening every chart. Its status moves SENT → RECEIVED → FITTED, with REMAKE for a
 * piece that went back; each move is a line in `history`, so "when did it come back, who took it
 * in" is answered by the order itself. `dueOn` is a calendar date in the clinic's zone
 * (ADR-0010): the lab promises Thursday, not an instant.
 *
 * Nothing here is deleted. An order sent by mistake is CANCELLED, with a reason in the history.
 */
export const LabOrderSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    patientId: { type: String, required: true },
    patient: {
      name: { type: String, required: true },
      medicalRecordNo: { type: String, required: true },
    },
    toothRecordIds: { type: [String], default: [] },
    teeth: { type: [String], default: [] },
    work: [
      {
        _id: false,
        name: { type: String, required: true },
        symbol: { type: String, enum: DENTAL_SYMBOLS, required: true },
      },
    ],
    labName: { type: String, required: true },
    sentOn: { type: String, required: true },
    dueOn: { type: String, required: true },
    status: { type: String, enum: LAB_ORDER_STATUSES, default: 'SENT' },
    notes: { type: String, default: null },
    history: [
      {
        _id: false,
        status: { type: String, enum: LAB_ORDER_STATUSES, required: true },
        at: { type: Date, required: true },
        by: { type: PersonRefSchema, default: null },
        note: { type: String, default: null },
        dueOn: { type: String, default: null },
      },
    ],
    createdBy: { type: PersonRefSchema, default: null },
  },
  { timestamps: true, collection: 'lab_orders' },
)

LabOrderSchema.plugin(tenantGuard)
LabOrderSchema.plugin(softDelete)
// Which patient is having which tooth crowned is PHI (11.3).
LabOrderSchema.plugin(auditCapture, { model: 'LabOrder', phiRead: true })

LabOrderSchema.index({ clinicId: 1, patientId: 1, createdAt: -1 }) // a patient's orders
LabOrderSchema.index({ clinicId: 1, status: 1, dueOn: 1 }) // the lab board, late first
LabOrderSchema.index({ clinicId: 1, toothRecordIds: 1 }) // a tooth's lab work

export type LabOrderDoc = InferSchemaType<typeof LabOrderSchema> & { _id: string }

export const LabOrderModel = (): Model<LabOrderDoc> =>
  getConnection().models.LabOrder ?? getConnection().model<LabOrderDoc>('LabOrder', LabOrderSchema)
