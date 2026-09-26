import { Schema, type InferSchemaType, type Model } from 'mongoose'
import {
  DENTAL_SYMBOLS,
  TOOTH_ROLES,
  TOOTH_SURFACES,
  TREATMENT_PLAN_STATUSES,
} from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { softDelete } from '../plugins/soft-delete'
import { auditCapture } from '../plugins/audit-capture'

const PersonRefSchema = new Schema({ id: String, name: String }, { _id: false })

/**
 * A treatment plan (Phase 12, ADR-0036): planned work from the tooth chart, put in phases and
 * priced, for the patient to agree to.
 *
 * Each item points at a PLANNED row of the chart. The teeth, surfaces and treatment are copied
 * for display — a plan is printed and signed, and what was signed must not move — but whether an
 * item is done is the chart's to say. `state`, `doneOn` and the completion ids are a cache of the
 * chart, rewritten from it whenever one of the plan's rows is completed or voided; `openItems` is
 * kept beside them because the recall list asks for "agreed, and still something to do".
 *
 * The prices are snapshots, as on an invoice: a price-list change after the patient agreed does
 * not change what they agreed to. Amounts are rounded per line (ADR-0027).
 *
 * Nothing here is deleted. A plan nobody wants any more is CANCELLED, with a reason.
 */
export const TreatmentPlanSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    patientId: { type: String, required: true },
    title: { type: String, required: true },
    status: { type: String, enum: TREATMENT_PLAN_STATUSES, default: 'DRAFT' },
    phases: { type: [String], default: [] },

    items: [
      {
        _id: idField,
        toothRecordId: { type: String, required: true },
        phase: { type: Number, required: true },
        teeth: [
          {
            _id: false,
            fdi: { type: String, required: true },
            role: { type: String, enum: [...TOOTH_ROLES, null], default: null },
          },
        ],
        surfaces: { type: [{ type: String, enum: TOOTH_SURFACES }], default: [] },
        treatment: {
          id: { type: String, required: true },
          code: { type: String, required: true },
          name: { type: String, required: true },
          symbol: { type: String, enum: DENTAL_SYMBOLS, required: true },
        },
        serviceId: { type: String, default: null },
        description: { type: String, required: true },
        quantity: { type: Schema.Types.Decimal128, required: true },
        unitPrice: { type: Schema.Types.Decimal128, required: true },
        discount: { type: Schema.Types.Decimal128, default: '0' },
        taxRatePercent: { type: Schema.Types.Decimal128, default: '0' },
        gross: { type: Schema.Types.Decimal128, required: true },
        net: { type: Schema.Types.Decimal128, required: true },
        tax: { type: Schema.Types.Decimal128, required: true },
        lineTotal: { type: Schema.Types.Decimal128, required: true },

        // The chart's answer, cached. See above.
        state: { type: String, enum: ['OPEN', 'DONE', 'DROPPED'], default: 'OPEN' },
        doneOn: { type: String, default: null },
        completedByRecordId: { type: String, default: null },
        completedInEncounterId: { type: String, default: null },

        billedInvoiceId: { type: String, default: null },
        billedInvoiceNumber: { type: String, default: null },
        billedAt: { type: Date, default: null },
      },
    ],
    openItems: { type: Number, default: 0 },

    currency: { type: String, required: true },
    subtotal: { type: Schema.Types.Decimal128, default: '0' },
    discountTotal: { type: Schema.Types.Decimal128, default: '0' },
    taxTotal: { type: Schema.Types.Decimal128, default: '0' },
    total: { type: Schema.Types.Decimal128, default: '0' },

    notes: { type: String, default: null },
    createdBy: { type: PersonRefSchema, default: null },

    presentedAt: { type: Date, default: null },
    /** When the patient answered, yes or no. */
    decidedAt: { type: Date, default: null },
    /** Kept apart from decidedAt: the recall list is ordered and filtered on it. */
    acceptedAt: { type: Date, default: null },
    decisionRecordedBy: { type: PersonRefSchema, default: null },
    signedBy: { type: String, default: null },
    signatureFileId: { type: String, default: null },
    declineReason: { type: String, default: null },

    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: PersonRefSchema, default: null },
    cancelReason: { type: String, default: null },
  },
  { timestamps: true, collection: 'treatment_plans' },
)

TreatmentPlanSchema.plugin(tenantGuard)
TreatmentPlanSchema.plugin(softDelete)
// A plan lists what is wrong with a patient's mouth and what it will cost them: PHI (11.3).
TreatmentPlanSchema.plugin(auditCapture, { model: 'TreatmentPlan', phiRead: true })

TreatmentPlanSchema.index({ clinicId: 1, patientId: 1, createdAt: -1 }) // a patient's plans
TreatmentPlanSchema.index({ clinicId: 1, 'items.toothRecordId': 1 }) // keeping items in step
TreatmentPlanSchema.index({ clinicId: 1, status: 1, openItems: 1, acceptedAt: 1 }) // recall

export type TreatmentPlanDoc = InferSchemaType<typeof TreatmentPlanSchema> & { _id: string }

export const TreatmentPlanModel = (): Model<TreatmentPlanDoc> =>
  getConnection().models.TreatmentPlan ??
  getConnection().model<TreatmentPlanDoc>('TreatmentPlan', TreatmentPlanSchema)
