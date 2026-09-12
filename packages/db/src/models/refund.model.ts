import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { auditCapture } from '../plugins/audit-capture'

const PersonRefSchema = new Schema({ id: String, name: String }, { _id: false })

/**
 * Money given back (section 8.10). Its own collection rather than a field on the payment,
 * for the same reason stock movements are their own collection: the ledger is the truth and
 * `payments.refundedAmount` is the projection. Two partial refunds on one payment are two
 * events, each with its own reason, time and cashier, and a single field could not hold them.
 *
 * The allocations record which invoices the money came back off, so an invoice that returns to
 * PARTIALLY_PAID can say exactly why.
 */
export const RefundSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    paymentId: { type: String, required: true },
    paymentNumber: { type: String, default: null },
    patientId: { type: String, required: true },

    amount: { type: Schema.Types.Decimal128, required: true },
    currency: { type: String, required: true },
    reason: { type: String, required: true },

    allocations: [
      {
        _id: false,
        invoiceId: { type: String, required: true },
        invoiceNumber: { type: String, default: null },
        amount: { type: Schema.Types.Decimal128, required: true },
      },
    ],

    refundedAt: { type: Date, default: Date.now },
    refundedBy: { type: PersonRefSchema, default: null },
  },
  { timestamps: true, collection: 'refunds' },
)

RefundSchema.plugin(tenantGuard)
RefundSchema.plugin(auditCapture, { model: 'Refund', phiRead: true })

RefundSchema.index({ clinicId: 1, refundedAt: -1 }) // daily reconciliation
RefundSchema.index({ clinicId: 1, paymentId: 1 })
RefundSchema.index({ clinicId: 1, patientId: 1, refundedAt: -1 })

export type RefundDoc = InferSchemaType<typeof RefundSchema> & { _id: string }

export const RefundModel = (): Model<RefundDoc> =>
  getConnection().models.Refund ?? getConnection().model<RefundDoc>('Refund', RefundSchema)
