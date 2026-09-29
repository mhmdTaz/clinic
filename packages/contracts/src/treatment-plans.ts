import { z } from 'zod'
import { PaginationQuery } from './envelope'
import { Quantity, TaxRatePercent } from './billing'
import { LocalDate, MoneyAmount, PersonRef, nullableText, requiredText } from './common'
import { DentalSymbol, ToothNumber, ToothRole, ToothSurface } from './dental'

/**
 * Contracts for treatment plans (Phase 12, ADR-0036).
 *
 * A plan gathers planned work from the tooth chart into phases the patient can say yes to, at
 * prices fixed when it was drafted. It never holds its own copy of the clinical facts: each item
 * points at a PLANNED row of the chart, and whether that work is done is read from the chart's
 * log. What the plan does own is the money — the price agreed, the discount given — and the
 * patient's decision.
 *
 * Amounts are decimal strings in the clinic's currency, as on an invoice (section 9.2).
 */

export const TreatmentPlanStatus = z.enum([
  'DRAFT',
  'PRESENTED',
  'ACCEPTED',
  'DECLINED',
  'COMPLETED',
  'CANCELLED',
])
export type TreatmentPlanStatus = z.infer<typeof TreatmentPlanStatus>

/** Where an item stands, read from the chart: to do, done, or dropped because its plan row was voided. */
export const PlanItemState = z.enum(['OPEN', 'DONE', 'DROPPED'])
export type PlanItemState = z.infer<typeof PlanItemState>

export const TreatmentPlanItemInput = z.object({
  /** A PLANNED, live, not yet done row of this patient's chart. */
  toothRecordId: z.string().max(64),
  /** Index into the plan's phases. */
  phase: z.number().int().min(0).max(5),
  /** Null: the usual count for this work — one per tooth for a bridge, one otherwise. */
  quantity: Quantity.nullable().default(null),
  /** Null: the price list's price for the treatment's service. Required when it has none. */
  unitPrice: MoneyAmount.nullable().default(null),
  /** Off the line, before tax, as on an invoice. */
  discount: MoneyAmount.default('0'),
})
export type TreatmentPlanItemInput = z.infer<typeof TreatmentPlanItemInput>

export const TreatmentPlanInput = z.object({
  title: requiredText(120),
  phases: z
    .array(z.object({ name: requiredText(60) }))
    .min(1)
    .max(6),
  items: z.array(TreatmentPlanItemInput).min(1).max(40),
  notes: nullableText(2000).default(null),
})
export type TreatmentPlanInput = z.infer<typeof TreatmentPlanInput>

export const TreatmentPlanItem = z.object({
  id: z.string(),
  toothRecordId: z.string(),
  phase: z.number().int(),
  teeth: z.array(z.object({ fdi: ToothNumber, role: ToothRole.nullable() })),
  surfaces: z.array(ToothSurface),
  treatment: z.object({ id: z.string(), code: z.string(), name: z.string(), symbol: DentalSymbol }),
  serviceId: z.string().nullable(),
  description: z.string(),
  quantity: z.string(),
  unitPrice: z.string(),
  discount: z.string(),
  taxRatePercent: TaxRatePercent,
  gross: z.string(),
  net: z.string(),
  tax: z.string(),
  lineTotal: z.string(),
  state: PlanItemState,
  /** The day the work was done, and the chart row and visit that did it. */
  doneOn: LocalDate.nullable(),
  completedByRecordId: z.string().nullable(),
  completedInEncounterId: z.string().nullable(),
  /** Set once the item has been put on an invoice; an item is billed once. */
  billed: z
    .object({ invoiceId: z.string(), invoiceNumber: z.string(), at: z.string().datetime() })
    .nullable(),
})
export type TreatmentPlanItem = z.infer<typeof TreatmentPlanItem>

export const TreatmentPlan = z.object({
  id: z.string(),
  patientId: z.string(),
  title: z.string(),
  status: TreatmentPlanStatus,
  phases: z.array(z.string()),
  items: z.array(TreatmentPlanItem),
  currency: z.string(),
  subtotal: z.string(),
  discountTotal: z.string(),
  taxTotal: z.string(),
  total: z.string(),
  /** What the items still to do add up to. */
  remaining: z.string(),
  progress: z.object({
    done: z.number().int(),
    open: z.number().int(),
    dropped: z.number().int(),
  }),
  notes: z.string().nullable(),
  createdBy: PersonRef.nullable(),
  createdAt: z.string().datetime(),
  presentedAt: z.string().datetime().nullable(),
  /** The patient's answer: accepted with a name and a signature, or turned down. */
  decision: z
    .object({
      at: z.string().datetime(),
      recordedBy: PersonRef.nullable(),
      signedBy: z.string().nullable(),
      signatureFileId: z.string().nullable(),
      reason: z.string().nullable(),
    })
    .nullable(),
  cancelled: z
    .object({ at: z.string().datetime(), by: PersonRef.nullable(), reason: z.string() })
    .nullable(),
})
export type TreatmentPlan = z.infer<typeof TreatmentPlan>

export const TreatmentPlanListQuery = PaginationQuery.extend({
  status: TreatmentPlanStatus.optional(),
})
export type TreatmentPlanListQuery = z.infer<typeof TreatmentPlanListQuery>

export const AcceptTreatmentPlanRequest = z.object({
  /** The name the patient (or their guardian) signed as. */
  signedBy: requiredText(120),
  /** The drawn signature, uploaded as a patient document first. */
  signatureFileId: z.string().max(64).nullable().default(null),
})
export type AcceptTreatmentPlanRequest = z.infer<typeof AcceptTreatmentPlanRequest>

export const DeclineTreatmentPlanRequest = z.object({ reason: nullableText(300).default(null) })
export type DeclineTreatmentPlanRequest = z.infer<typeof DeclineTreatmentPlanRequest>

export const CancelTreatmentPlanRequest = z.object({ reason: requiredText(300) })
export type CancelTreatmentPlanRequest = z.infer<typeof CancelTreatmentPlanRequest>

/** Putting a done item on a visit's invoice, at the price the patient agreed to. */
export const BillPlanItemRequest = z.object({ encounterId: z.string().max(64) })
export type BillPlanItemRequest = z.infer<typeof BillPlanItemRequest>

export const PlanItemBilled = z.object({
  invoiceId: z.string(),
  invoiceNumber: z.string(),
  currency: z.string(),
  billed: z.string(),
})
export type PlanItemBilled = z.infer<typeof PlanItemBilled>

// ── Recall ───────────────────────────────────────────────────────────────────

export const OverduePlansQuery = PaginationQuery.extend({
  /** Plans agreed to at least this many days ago with work still open. */
  olderThanDays: z.coerce.number().int().min(0).max(730).default(30),
  /** Leave out patients who already have a visit booked. On unless turned off. */
  unbooked: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default('true'),
})
export type OverduePlansQuery = z.infer<typeof OverduePlansQuery>

export const OverduePlan = z.object({
  planId: z.string(),
  title: z.string(),
  patient: z.object({
    id: z.string(),
    name: z.string(),
    medicalRecordNo: z.string(),
    phone: z.string().nullable(),
  }),
  acceptedAt: z.string().datetime(),
  openItems: z.number().int(),
  totalItems: z.number().int(),
  remaining: z.string(),
  currency: z.string(),
  nextAppointmentAt: z.string().datetime().nullable(),
})
export type OverduePlan = z.infer<typeof OverduePlan>
