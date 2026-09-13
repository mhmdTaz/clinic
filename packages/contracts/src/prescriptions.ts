import { z } from 'zod'
import { PaginationQuery } from './envelope'
import {
  IdParam,
  PersonRef,
  nullableInteger,
  nullableLocalDate,
  nullableText,
  requiredText,
} from './common'

/**
 * Contracts for prescriptions (D8, P7). A separate collection from the encounter, per the
 * embedding rule in section 8.2: a prescription is read on its own — the pharmacy's copy, the
 * patient's list of current medications — and outlives the visit that produced it.
 */

export const PrescriptionItemInput = z.object({
  drugName: requiredText(200),
  strength: nullableText(60),
  form: nullableText(60),
  dosage: requiredText(120),
  frequency: requiredText(120),
  durationDays: nullableInteger(1, 3650),
  quantity: nullableInteger(1, 10_000),
  instructions: nullableText(300),
  isRefillable: z.boolean().default(false),
})
export type PrescriptionItemInput = z.infer<typeof PrescriptionItemInput>

export const PrescriptionItem = PrescriptionItemInput.extend({ id: z.string() })
export type PrescriptionItem = z.infer<typeof PrescriptionItem>

export const IssuePrescriptionRequest = z.object({
  /** At least one: a prescription with nothing on it is a mistake, not an empty state. */
  items: z.array(PrescriptionItemInput).min(1).max(20),
  validUntil: nullableLocalDate,
  notes: nullableText(500),
})
export type IssuePrescriptionRequest = z.infer<typeof IssuePrescriptionRequest>

export const Prescription = z.object({
  id: z.string(),
  number: z.string(),
  encounterId: z.string(),
  patient: z.object({ id: z.string(), name: z.string(), medicalRecordNo: z.string() }),
  doctor: z.object({ id: z.string(), name: z.string(), licenseNumber: z.string().nullable() }),
  issuedAt: z.string().datetime(),
  validUntil: z.string().nullable(),
  notes: z.string().nullable(),
  items: z.array(PrescriptionItem),
  /** Set once the PDF has been rendered and stored; null until then (ADR-0026). */
  pdfFileId: z.string().nullable(),
  issuedBy: PersonRef.nullable(),
})
export type Prescription = z.infer<typeof Prescription>

export const PrescriptionListQuery = PaginationQuery.extend({
  patientId: z.string().max(64).optional(),
  encounterId: z.string().max(64).optional(),
  /** Only what the patient is still meant to be taking (P7). */
  active: z.coerce.boolean().optional(),
})
export type PrescriptionListQuery = z.infer<typeof PrescriptionListQuery>

export const PrescriptionIdParam = IdParam
