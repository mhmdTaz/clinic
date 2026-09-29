import { z } from 'zod'
import { PaginationQuery } from './envelope'
import { LocalDate, PersonRef, nullableLocalDate, nullableText, requiredText } from './common'
import { DentalSymbol, ToothNumber } from './dental'

/**
 * Lab work (Phase 13): a crown, a bridge or a denture made outside the clinic. It is sent with an
 * impression, comes back, and is fitted — or does not fit and goes back as a remake. The order
 * points at the chart rows it is for, so the tooth drawer can say "at the lab, due Thursday".
 *
 * `overdue` is worked out on read, from the clinic's today and the due date, never stored.
 */

export const LabOrderStatus = z.enum(['SENT', 'RECEIVED', 'FITTED', 'REMAKE', 'CANCELLED'])
export type LabOrderStatus = z.infer<typeof LabOrderStatus>

export const CreateLabOrderRequest = z.object({
  /** Live rows of this patient's chart — usually the planned crown or bridge it is made for. */
  toothRecordIds: z.array(z.string().max(64)).min(1).max(16),
  labName: requiredText(120),
  /** Defaults to today in the clinic's zone. */
  sentOn: nullableLocalDate.default(null),
  dueOn: LocalDate,
  /** Shade, material, anything the lab was told. */
  notes: nullableText(1000).default(null),
})
export type CreateLabOrderRequest = z.infer<typeof CreateLabOrderRequest>

/**
 * Moving an order on. A remake is sent back with a new due date; cancelling needs a reason, as
 * the order stays on the record.
 */
export const ChangeLabOrderStatusRequest = z.object({
  status: z.enum(['RECEIVED', 'FITTED', 'REMAKE', 'CANCELLED']),
  dueOn: nullableLocalDate.default(null),
  note: nullableText(300).default(null),
})
export type ChangeLabOrderStatusRequest = z.infer<typeof ChangeLabOrderStatusRequest>

export const LabOrder = z.object({
  id: z.string(),
  patientId: z.string(),
  patient: z.object({ name: z.string(), medicalRecordNo: z.string() }),
  toothRecordIds: z.array(z.string()),
  teeth: z.array(ToothNumber),
  /** What was sent for, as charted: "Porcelain-fused-to-metal crown". */
  work: z.array(z.object({ name: z.string(), symbol: DentalSymbol })),
  labName: z.string(),
  sentOn: LocalDate,
  dueOn: LocalDate,
  status: LabOrderStatus,
  overdue: z.boolean(),
  notes: z.string().nullable(),
  history: z.array(
    z.object({
      status: LabOrderStatus,
      at: z.string().datetime(),
      by: PersonRef.nullable(),
      note: z.string().nullable(),
      dueOn: LocalDate.nullable(),
    }),
  ),
  createdBy: PersonRef.nullable(),
  createdAt: z.string().datetime(),
})
export type LabOrder = z.infer<typeof LabOrder>

export const PatientLabOrderQuery = PaginationQuery.extend({
  /** Only what is still out — sent, or sent back for a remake — or back but not yet fitted. */
  open: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
})
export type PatientLabOrderQuery = z.infer<typeof PatientLabOrderQuery>

export const LabOrderListQuery = PaginationQuery.extend({
  status: LabOrderStatus.optional(),
  /** Still at the lab and past its due date. */
  overdue: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
})
export type LabOrderListQuery = z.infer<typeof LabOrderListQuery>

// ── Voice charting (ADR-0037) ────────────────────────────────────────────────

/**
 * Turning voice charting on is a decision about where the clinic's audio goes, so it is made with
 * the consequence stated and acknowledged, and it is on the record who made it.
 */
export const SetVoiceChartingRequest = z.object({
  enabled: z.boolean(),
  /** Must be true to turn it on: the administrator has read where the audio goes. */
  acknowledged: z.boolean().default(false),
})
export type SetVoiceChartingRequest = z.infer<typeof SetVoiceChartingRequest>

export const VoiceChartingSetting = z.object({ enabled: z.boolean() })
export type VoiceChartingSetting = z.infer<typeof VoiceChartingSetting>
