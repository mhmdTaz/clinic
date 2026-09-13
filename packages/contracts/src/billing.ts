import { z } from 'zod'
import { PaginationQuery } from './envelope'
import {
  IdParam,
  LocalDate,
  MoneyAmount,
  PersonRef,
  nullableLocalDate,
  nullableText,
  requiredText,
} from './common'

/**
 * Contracts for billing (S7, S8, S9, P8).
 *
 * Every amount is a decimal string, and every one of them is the currency's own precision — see
 * money.ts for the arithmetic. A JSON number would be a float, and a float cannot hold cents.
 */

export const InvoiceStatus = z.enum(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID'])
export type InvoiceStatus = z.infer<typeof InvoiceStatus>

export const PaymentMethod = z.enum(['CASH', 'CARD', 'TRANSFER', 'INSURANCE'])
export type PaymentMethod = z.infer<typeof PaymentMethod>

export const PaymentStatus = z.enum(['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'])
export type PaymentStatus = z.infer<typeof PaymentStatus>

/** A quantity may be fractional — half an hour of physiotherapy is a real line on a bill. */
export const Quantity = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,3})?$/, 'INVALID_QUANTITY')
  .refine((value) => Number(value) > 0, 'TOO_SMALL')

/** A tax rate as a percentage: "11" is eleven percent, "8.25" is eight and a quarter. */
export const TaxRatePercent = z
  .string()
  .trim()
  .regex(/^\d{1,2}(\.\d{1,3})?$/, 'INVALID_RATE')
  .refine((value) => Number(value) <= 100, 'TOO_LARGE')

// ── The service catalogue (A6) ───────────────────────────────────────────────

export const ServiceInput = z.object({
  name: requiredText(120),
  description: nullableText(300),
  price: MoneyAmount,
  taxRatePercent: TaxRatePercent.default('0'),
  /** What it usually takes, so scheduling can offer it later without a second catalogue. */
  durationMinutes: z.coerce.number().int().min(5).max(480).nullable().default(null),
  isActive: z.boolean().default(true),
})
export type ServiceInput = z.infer<typeof ServiceInput>

export const Service = ServiceInput.extend({ id: z.string(), currency: z.string() })
export type Service = z.infer<typeof Service>

export const ServiceListQuery = z.object({
  status: z.enum(['active', 'inactive', 'all']).default('active'),
})
export type ServiceListQuery = z.infer<typeof ServiceListQuery>

// ── Invoices (S7) ────────────────────────────────────────────────────────────

/**
 * A line is a price snapshot. The catalogue changes; what a patient was charged on a Tuesday
 * does not, so the description and the unit price are copied onto the invoice rather than
 * referenced (section 8.2).
 */
export const InvoiceLineInput = z.object({
  serviceId: z.string().max(64).nullable().default(null),
  description: requiredText(200),
  quantity: Quantity,
  unitPrice: MoneyAmount,
  discount: MoneyAmount.default('0'),
  taxRatePercent: TaxRatePercent.default('0'),
})
export type InvoiceLineInput = z.infer<typeof InvoiceLineInput>

export const InvoiceLine = InvoiceLineInput.extend({
  id: z.string(),
  /** unitPrice × quantity, before the discount. */
  gross: z.string(),
  /** gross − discount. */
  net: z.string(),
  tax: z.string(),
  /** net + tax. The lines sum to the invoice total, exactly (ADR-0027). */
  lineTotal: z.string(),
})
export type InvoiceLine = z.infer<typeof InvoiceLine>

export const CreateInvoiceRequest = z.object({
  patientId: IdParam,
  /** The visit it came out of, where there is one. */
  encounterId: z.string().max(64).nullable().default(null),
  branchId: z.string().max(64).nullable().default(null),
  /**
   * Left empty against an encounter, the clinic's own starting point is used: the doctor's
   * consultation fee. It is a draft — the front desk edits it before issuing.
   */
  lines: z.array(InvoiceLineInput).max(50).default([]),
  notes: nullableText(500),
})
export type CreateInvoiceRequest = z.infer<typeof CreateInvoiceRequest>

export const UpdateInvoiceRequest = z.object({
  lines: z.array(InvoiceLineInput).max(50).optional(),
  notes: nullableText(500).optional(),
})
export type UpdateInvoiceRequest = z.infer<typeof UpdateInvoiceRequest>

export const IssueInvoiceRequest = z.object({ dueAt: nullableLocalDate })
export type IssueInvoiceRequest = z.infer<typeof IssueInvoiceRequest>

export const VoidInvoiceRequest = z.object({ reason: requiredText(300) })
export type VoidInvoiceRequest = z.infer<typeof VoidInvoiceRequest>

export const InvoiceSummary = z.object({
  id: z.string(),
  number: z.string(),
  status: InvoiceStatus,
  patient: z.object({ id: z.string(), name: z.string(), medicalRecordNo: z.string() }),
  encounterId: z.string().nullable(),
  issuedAt: z.string().datetime().nullable(),
  dueAt: z.string().nullable(),
  currency: z.string(),
  total: z.string(),
  amountPaid: z.string(),
  balanceDue: z.string(),
  /** Derived from today and the due date, never stored — see INVOICE_STATUSES. */
  isOverdue: z.boolean(),
})
export type InvoiceSummary = z.infer<typeof InvoiceSummary>

export const InvoiceDetail = InvoiceSummary.extend({
  branchId: z.string().nullable(),
  lines: z.array(InvoiceLine),
  subtotal: z.string(),
  discountTotal: z.string(),
  taxTotal: z.string(),
  notes: z.string().nullable(),
  pdfFileId: z.string().nullable(),
  voidedAt: z.string().datetime().nullable(),
  voidReason: z.string().nullable(),
  createdAt: z.string().datetime().nullable(),
  createdBy: PersonRef.nullable(),
})
export type InvoiceDetail = z.infer<typeof InvoiceDetail>

export const InvoiceListQuery = PaginationQuery.extend({
  patientId: z.string().max(64).optional(),
  encounterId: z.string().max(64).optional(),
  status: InvoiceStatus.optional(),
  /** Only what still owes money — the outstanding-balance report. */
  outstanding: z.coerce.boolean().optional(),
  from: LocalDate.optional(),
  to: LocalDate.optional(),
})
export type InvoiceListQuery = z.infer<typeof InvoiceListQuery>

// ── Payments (S8) ────────────────────────────────────────────────────────────

export const PaymentAllocationInput = z.object({ invoiceId: IdParam, amount: MoneyAmount })
export type PaymentAllocationInput = z.infer<typeof PaymentAllocationInput>

export const RecordPaymentRequest = z.object({
  patientId: IdParam,
  amount: MoneyAmount,
  method: PaymentMethod,
  reference: nullableText(120),
  note: nullableText(300),
  /** What this money settles. One payment may clear several invoices at once. */
  allocations: z.array(PaymentAllocationInput).min(1).max(20),
  /**
   * The client's own key for this attempt. A double-clicked button sends the same one twice and
   * gets the same payment back, rather than taking the money twice (ADR-0028).
   */
  idempotencyKey: requiredText(64),
})
export type RecordPaymentRequest = z.infer<typeof RecordPaymentRequest>

export const RefundPaymentRequest = z.object({
  amount: MoneyAmount,
  reason: requiredText(300),
})
export type RefundPaymentRequest = z.infer<typeof RefundPaymentRequest>

export const PaymentAllocation = z.object({
  invoiceId: z.string(),
  invoiceNumber: z.string().nullable(),
  amount: z.string(),
})
export type PaymentAllocation = z.infer<typeof PaymentAllocation>

export const Payment = z.object({
  id: z.string(),
  number: z.string(),
  status: PaymentStatus,
  patient: z.object({ id: z.string(), name: z.string(), medicalRecordNo: z.string() }),
  amount: z.string(),
  refundedAmount: z.string(),
  currency: z.string(),
  method: PaymentMethod,
  reference: z.string().nullable(),
  note: z.string().nullable(),
  receivedAt: z.string().datetime(),
  receivedBy: PersonRef.nullable(),
  allocations: z.array(PaymentAllocation),
  pdfFileId: z.string().nullable(),
})
export type Payment = z.infer<typeof Payment>

export const PaymentListQuery = PaginationQuery.extend({
  patientId: z.string().max(64).optional(),
  invoiceId: z.string().max(64).optional(),
  method: PaymentMethod.optional(),
  from: LocalDate.optional(),
  to: LocalDate.optional(),
})
export type PaymentListQuery = z.infer<typeof PaymentListQuery>

// ── The day's money (S9) ─────────────────────────────────────────────────────

export const DailyReconciliationQuery = z.object({ date: LocalDate })
export type DailyReconciliationQuery = z.infer<typeof DailyReconciliationQuery>

export const MethodTotal = z.object({
  method: PaymentMethod,
  taken: z.string(),
  refunded: z.string(),
  net: z.string(),
  count: z.number(),
})
export type MethodTotal = z.infer<typeof MethodTotal>

export const DailyReconciliation = z.object({
  date: z.string(),
  currency: z.string(),
  byMethod: z.array(MethodTotal),
  taken: z.string(),
  refunded: z.string(),
  net: z.string(),
  count: z.number(),
  invoiced: z.string(),
  invoiceCount: z.number(),
})
export type DailyReconciliation = z.infer<typeof DailyReconciliation>

/**
 * Whose statement. A patient always gets their own, whatever is sent; a doctor must name a patient
 * they have treated; the clinic names one, or omits it for totals across every patient.
 */
export const AccountStatementQuery = z.object({ patientId: z.string().max(64).optional() })
export type AccountStatementQuery = z.infer<typeof AccountStatementQuery>

/** A patient's statement of account (P8): what they have been billed, and what they have paid. */
export const AccountStatement = z.object({
  currency: z.string(),
  invoiced: z.string(),
  paid: z.string(),
  outstanding: z.string(),
  /** The most recent invoices. The totals above always cover all of them. */
  invoices: z.array(InvoiceSummary),
  payments: z.array(Payment),
  /**
   * Whether there are older invoices or payments than the ones listed. Before Phase 10 the lines
   * stopped at 200 with nothing to say so, while the totals counted everything — a statement whose
   * lines did not add up to its own balance. The full lists page at `/billing/invoices` and
   * `/billing/payments`.
   */
  hasMoreInvoices: z.boolean(),
  hasMorePayments: z.boolean(),
})
export type AccountStatement = z.infer<typeof AccountStatement>
