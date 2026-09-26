import { z } from 'zod'
import { PaginationQuery } from './envelope'
import { LocalDate, PersonRef, nullableLocalDate, nullableText, requiredText } from './common'

/**
 * Contracts for the tooth chart (Phase 11, ADR-0035).
 *
 * What is stored is a log: one row per thing charted on a tooth, never edited afterwards. What is
 * drawn is worked out from the log — which marks a tooth shows today, whether it is still in the
 * mouth — so the chart can be replayed as it stood on any day, and every mark on it can be traced
 * back to the visit it was made in.
 */

export const ToothRecordStatus = z.enum(['CONDITION', 'PLANNED', 'COMPLETED', 'EXISTING'])
export type ToothRecordStatus = z.infer<typeof ToothRecordStatus>

export const ToothSurface = z.enum(['M', 'D', 'O', 'I', 'B', 'L'])
export type ToothSurface = z.infer<typeof ToothSurface>

export const Dentition = z.enum(['PERMANENT', 'PRIMARY', 'MIXED'])
export type Dentition = z.infer<typeof Dentition>

export const DentalSymbol = z.enum([
  'CROWN',
  'ROOT_CANAL',
  'FILLING',
  'IMPLANT',
  'EXTRACTION',
  'MISSING',
  'BRIDGE',
  'DENTURE',
  'VENEER',
  'SEALANT',
  'CARIES',
  'FRACTURE',
  'IMPACTED',
  'OTHER',
])
export type DentalSymbol = z.infer<typeof DentalSymbol>

export const DentalScope = z.enum(['TOOTH', 'SURFACE', 'SPAN', 'ARCH'])
export type DentalScope = z.infer<typeof DentalScope>

export const ToothRole = z.enum(['ABUTMENT', 'PONTIC', 'DENTURE_TOOTH'])
export type ToothRole = z.infer<typeof ToothRole>

/**
 * A tooth in FDI two-digit notation (ISO 3950): quadrant then position. 11–48 for permanent
 * teeth, 51–85 for primary ones. Which of them a given patient can have is the dentition's
 * business, and is checked on the server.
 */
export const ToothNumber = z.string().regex(/^([1-4][1-8]|[5-8][1-5])$/, 'INVALID_TOOTH')
export type ToothNumber = z.infer<typeof ToothNumber>

// ── The catalogue ────────────────────────────────────────────────────────────

export const DentalTreatmentInput = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{1,32}$/, 'INVALID_CODE'),
  name: requiredText(80),
  symbol: DentalSymbol,
  scope: DentalScope,
  serviceId: z.string().max(64).nullable().default(null),
  sortOrder: z.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
})
export type DentalTreatmentInput = z.infer<typeof DentalTreatmentInput>

export const DentalTreatment = DentalTreatmentInput.extend({ id: z.string() })
export type DentalTreatment = z.infer<typeof DentalTreatment>

export const QuickPickItem = z.object({
  treatmentId: z.string().max(64),
  surfaces: z.array(ToothSurface).max(5).default([]),
  status: ToothRecordStatus,
})
export type QuickPickItem = z.infer<typeof QuickPickItem>

export const QuickPickInput = z.object({
  name: requiredText(60),
  items: z.array(QuickPickItem).min(1).max(10),
  sortOrder: z.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
})
export type QuickPickInput = z.infer<typeof QuickPickInput>

export const QuickPick = QuickPickInput.extend({ id: z.string(), doctorId: z.string().nullable() })
export type QuickPick = z.infer<typeof QuickPick>

// ── The log ──────────────────────────────────────────────────────────────────

export const ChartedTooth = z.object({ fdi: ToothNumber, role: ToothRole.nullable().default(null) })
export type ChartedTooth = z.infer<typeof ChartedTooth>

/**
 * Charting one thing. The visit defaults to none and the date to today in the clinic's zone; a
 * crown charted at intake as EXISTING belongs to no visit here and was done by nobody we know.
 */
export const AddToothRecordRequest = z.object({
  teeth: z.array(ChartedTooth).min(1).max(16),
  surfaces: z.array(ToothSurface).max(5).default([]),
  treatmentId: z.string().max(64),
  status: ToothRecordStatus,
  encounterId: z.string().max(64).nullable().default(null),
  performedOn: nullableLocalDate.default(null),
  doctorId: z.string().max(64).nullable().default(null),
  notes: nullableText(1000).default(null),
})
export type AddToothRecordRequest = z.infer<typeof AddToothRecordRequest>

/** Carrying out planned work. The planned row stays as it was; a COMPLETED row points at it. */
export const CompleteToothRecordRequest = z.object({
  encounterId: z.string().max(64).nullable().default(null),
  performedOn: nullableLocalDate.default(null),
  doctorId: z.string().max(64).nullable().default(null),
  notes: nullableText(1000).default(null),
})
export type CompleteToothRecordRequest = z.infer<typeof CompleteToothRecordRequest>

export const VoidToothRecordRequest = z.object({ reason: requiredText(300) })
export type VoidToothRecordRequest = z.infer<typeof VoidToothRecordRequest>

export const ApplyQuickPickRequest = z.object({
  teeth: z.array(ChartedTooth).min(1).max(16),
  encounterId: z.string().max(64).nullable().default(null),
  performedOn: nullableLocalDate.default(null),
  doctorId: z.string().max(64).nullable().default(null),
  notes: nullableText(1000).default(null),
})
export type ApplyQuickPickRequest = z.infer<typeof ApplyQuickPickRequest>

export const ToothRecord = z.object({
  id: z.string(),
  patientId: z.string(),
  encounterId: z.string().nullable(),
  teeth: z.array(z.object({ fdi: ToothNumber, role: ToothRole.nullable() })),
  surfaces: z.array(ToothSurface),
  treatment: z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    symbol: DentalSymbol,
    scope: DentalScope,
  }),
  status: ToothRecordStatus,
  completesRecordId: z.string().nullable(),
  /** Set on a PLANNED row once it has been carried out: the COMPLETED row that did it. */
  completedByRecordId: z.string().nullable(),
  notes: z.string().nullable(),
  performedOn: LocalDate,
  doctor: PersonRef.nullable(),
  recordedBy: PersonRef.nullable(),
  createdAt: z.string().datetime().nullable(),
  voided: z
    .object({ at: z.string().datetime(), by: PersonRef.nullable(), reason: z.string() })
    .nullable(),
})
export type ToothRecord = z.infer<typeof ToothRecord>

export const ToothRecordListQuery = PaginationQuery.extend({
  tooth: ToothNumber.optional(),
  status: ToothRecordStatus.optional(),
  doctorId: z.string().max(64).optional(),
  encounterId: z.string().max(64).optional(),
  from: LocalDate.optional(),
  to: LocalDate.optional(),
  /** Voided rows are hidden unless asked for: the audit view wants them, the drawer does not. */
  includeVoided: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
})
export type ToothRecordListQuery = z.infer<typeof ToothRecordListQuery>

// ── The picture ──────────────────────────────────────────────────────────────

/** One mark a tooth shows: a crown, a filling on MO, a planned extraction. */
export const ToothMark = z.object({
  recordId: z.string(),
  symbol: DentalSymbol,
  status: ToothRecordStatus,
  surfaces: z.array(ToothSurface),
  role: ToothRole.nullable(),
  treatmentName: z.string(),
  performedOn: LocalDate,
})
export type ToothMark = z.infer<typeof ToothMark>

export const ToothState = z.object({
  fdi: ToothNumber,
  /** False once the tooth is out of the mouth — extracted, missing — and nothing stands in for it. */
  present: z.boolean(),
  marks: z.array(ToothMark),
})
export type ToothState = z.infer<typeof ToothState>

export const DentalChartQuery = z.object({
  /** Replay the chart as it stood at the end of this day. Absent means today. */
  asOf: LocalDate.optional(),
})
export type DentalChartQuery = z.infer<typeof DentalChartQuery>

export const DentalChart = z.object({
  patientId: z.string(),
  dentition: Dentition,
  asOf: LocalDate.nullable(),
  /** Every tooth the dentition has, charted or not, in FDI order. */
  teeth: z.array(ToothState),
  /** The most recent day anything was charted, and the teeth touched on it. */
  lastCharted: z
    .object({
      performedOn: LocalDate,
      encounterId: z.string().nullable(),
      teeth: z.array(ToothNumber),
    })
    .nullable(),
  /** Every day something was charted, oldest first: the stops on the time slider. */
  history: z.array(LocalDate),
})
export type DentalChart = z.infer<typeof DentalChart>

export const SetDentitionRequest = z.object({ dentition: Dentition })
export type SetDentitionRequest = z.infer<typeof SetDentitionRequest>
