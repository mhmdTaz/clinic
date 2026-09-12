import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { INVOICE_STATUSES } from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { auditCapture } from '../plugins/audit-capture'

const PersonRefSchema = new Schema({ id: String, name: String }, { _id: false })

/**
 * An invoice (section 8.10). The lines are embedded because they are price snapshots with no
 * meaning outside the invoice, are always read with it, and are bounded by it.
 *
 * There is no soft delete here. A financial document is never removed, it is VOIDed — with a
 * reason, on the record — because the sequence of invoice numbers has to stay accountable and a
 * hidden row is an unexplained gap. `balanceDue` is stored rather than derived because it is the
 * thing the outstanding-balance report queries and indexes, and it is only ever moved by the
 * conditional pipeline update in the payment repository, never by a read-then-write.
 *
 * OVERDUE is deliberately absent from the statuses: whether an invoice is late is a question
 * about today and its due date, so it is derived on read rather than stored and swept by a
 * nightly job that can quietly stop running.
 */
export const InvoiceSchema = new Schema(
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
    /** The visit it came out of, where there is one. */
    encounterId: { type: String, default: null },

    status: { type: String, enum: INVOICE_STATUSES, default: 'DRAFT' },
    issuedAt: { type: Date, default: null },
    /** A calendar date in the clinic's zone (ADR-0010) — "due on the 30th", not an instant. */
    dueAt: { type: String, default: null },

    lines: [
      {
        _id: idField,
        serviceId: { type: String, default: null },
        /** Phase 6 fills this in; the shape is here so the line need not change then. */
        inventoryItemId: { type: String, default: null },
        description: { type: String, required: true },
        quantity: { type: Schema.Types.Decimal128, required: true },
        unitPrice: { type: Schema.Types.Decimal128, required: true },
        discount: { type: Schema.Types.Decimal128, default: '0' },
        taxRatePercent: { type: Schema.Types.Decimal128, default: '0' },
        /** unitPrice x quantity, before the discount. */
        gross: { type: Schema.Types.Decimal128, required: true },
        /** gross - discount. */
        net: { type: Schema.Types.Decimal128, required: true },
        tax: { type: Schema.Types.Decimal128, required: true },
        /** net + tax. Rounded once, per line, so the lines sum to the total (ADR-0027). */
        lineTotal: { type: Schema.Types.Decimal128, required: true },
      },
    ],

    currency: { type: String, required: true },
    subtotal: { type: Schema.Types.Decimal128, default: '0' },
    discountTotal: { type: Schema.Types.Decimal128, default: '0' },
    taxTotal: { type: Schema.Types.Decimal128, default: '0' },
    total: { type: Schema.Types.Decimal128, default: '0' },
    amountPaid: { type: Schema.Types.Decimal128, default: '0' },
    balanceDue: { type: Schema.Types.Decimal128, default: '0' },

    notes: { type: String, default: null },
    /** Null until the PDF has been rendered and stored (ADR-0026). */
    pdfFileId: { type: String, default: null },

    voidedAt: { type: Date, default: null },
    voidReason: { type: String, default: null },
    voidedBy: { type: PersonRefSchema, default: null },
    createdBy: { type: PersonRefSchema, default: null },
  },
  { timestamps: true, collection: 'invoices' },
)

InvoiceSchema.plugin(tenantGuard)
// What was billed says what was done: a bill names the patient and lists the care (11.3).
InvoiceSchema.plugin(auditCapture, {
  model: 'Invoice',
  phiRead: true,
  // Rendering the PDF is not a change to what was billed.
  ignoredPaths: ['pdfFileId'],
})

InvoiceSchema.index({ clinicId: 1, number: 1 }, { unique: true })
InvoiceSchema.index({ clinicId: 1, status: 1, issuedAt: -1 })
InvoiceSchema.index({ clinicId: 1, patientId: 1, createdAt: -1 })
InvoiceSchema.index({ clinicId: 1, balanceDue: 1 }) // the outstanding-balance report
InvoiceSchema.index({ clinicId: 1, encounterId: 1 }, { sparse: true })
InvoiceSchema.index({ clinicId: 1, issuedAt: -1 }) // the day's invoicing

export type InvoiceDoc = InferSchemaType<typeof InvoiceSchema> & { _id: string }

export const InvoiceModel = (): Model<InvoiceDoc> =>
  getConnection().models.Invoice ?? getConnection().model<InvoiceDoc>('Invoice', InvoiceSchema)
