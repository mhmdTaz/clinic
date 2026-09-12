import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { PAYMENT_METHODS, PAYMENT_STATUSES } from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { auditCapture } from '../plugins/audit-capture'

const PersonRefSchema = new Schema({ id: String, name: String }, { _id: false })

/**
 * Money taken (section 8.10). The payment owns the split, because one payment may settle several
 * invoices at once — a patient handing over a note for two visits is one movement of money and
 * two settlements, and modelling it the other way round would invent a payment that never
 * happened.
 *
 * `idempotencyKey` is what makes a double-clicked button safe (ADR-0028). It is unique per
 * clinic, so the second insert loses on the index rather than on a prior read, and the caller is
 * handed the payment that already exists. No soft delete: money taken is not un-taken, it is
 * refunded, and the refund is its own document.
 *
 * `refundedAmount` is a projection of the refunds ledger, kept here because every screen that
 * shows a payment shows how much of it came back.
 */
export const PaymentSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    branchId: { type: String, default: null },
    number: { type: String, required: true },

    patientId: { type: String, required: true },
    patient: {
      name: { type: String, required: true },
      medicalRecordNo: { type: String, required: true },
    },

    amount: { type: Schema.Types.Decimal128, required: true },
    refundedAmount: { type: Schema.Types.Decimal128, default: '0' },
    currency: { type: String, required: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'COMPLETED' },

    /** The cheque number, the card's last four, the transfer's reference. */
    reference: { type: String, default: null },
    note: { type: String, default: null },

    receivedAt: { type: Date, default: Date.now },
    receivedBy: { type: PersonRefSchema, default: null },

    allocations: [
      {
        _id: false,
        invoiceId: { type: String, required: true },
        invoiceNumber: { type: String, default: null },
        amount: { type: Schema.Types.Decimal128, required: true },
      },
    ],

    idempotencyKey: { type: String, required: true },
    /** Null until the receipt has been rendered and stored (ADR-0026). */
    pdfFileId: { type: String, default: null },
  },
  { timestamps: true, collection: 'payments' },
)

PaymentSchema.plugin(tenantGuard)
PaymentSchema.plugin(auditCapture, {
  model: 'Payment',
  phiRead: true,
  ignoredPaths: ['pdfFileId'],
})

// The double-click guard. Unique per clinic: two tenants may generate the same client key.
PaymentSchema.index({ clinicId: 1, idempotencyKey: 1 }, { unique: true })
PaymentSchema.index({ clinicId: 1, receivedAt: -1 }) // daily reconciliation
PaymentSchema.index({ clinicId: 1, patientId: 1, receivedAt: -1 })
PaymentSchema.index({ clinicId: 1, 'allocations.invoiceId': 1 }) // multikey: an invoice's payments
PaymentSchema.index({ clinicId: 1, number: 1 }, { unique: true })

export type PaymentDoc = InferSchemaType<typeof PaymentSchema> & { _id: string }

export const PaymentModel = (): Model<PaymentDoc> =>
  getConnection().models.Payment ?? getConnection().model<PaymentDoc>('Payment', PaymentSchema)
