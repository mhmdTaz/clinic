import { z } from 'zod'
import {
  BloodType,
  Gender,
  PersonRef,
  UserStatus,
  blankToNull,
  nullableCountry,
  nullableEmail,
  nullableLocalDate,
  nullableText,
  requiredText,
} from './common'
import { Allergy, ChronicCondition } from './clinical'
import { PaginationQuery } from './envelope'

/** Patient registration and the directory (S2, section 9.3). */

export const EmergencyContactInput = z.object({
  name: requiredText(120),
  relationship: nullableText(40),
  phone: requiredText(32),
})
export type EmergencyContactInput = z.infer<typeof EmergencyContactInput>

export const PatientInput = z.object({
  firstName: requiredText(80),
  lastName: requiredText(80),
  dateOfBirth: nullableLocalDate,
  gender: z.preprocess(blankToNull, Gender.nullable()),
  nationalId: nullableText(40),
  bloodType: BloodType.default('UNKNOWN'),
  contact: z.object({ phone: nullableText(32), email: nullableEmail }),
  address: z.object({
    line1: nullableText(160),
    city: nullableText(80),
    country: nullableCountry,
  }),
  emergencyContacts: z.array(EmergencyContactInput).max(5).default([]),
  adminNotes: nullableText(2000),
})
export type PatientInput = z.infer<typeof PatientInput>

/**
 * Saving despite a possible duplicate takes a typed reason, and it is recorded in the audit
 * log with the candidates the person dismissed (ADR-0020).
 */
export const DuplicateOverride = z.object({
  reason: z.string().trim().min(5, 'REASON_TOO_SHORT').max(300),
  candidateIds: z.array(z.string().min(1).max(64)).min(1).max(20),
})
export type DuplicateOverride = z.infer<typeof DuplicateOverride>

export const RegisterPatientRequest = PatientInput.extend({
  duplicateOverride: DuplicateOverride.nullable().default(null),
  inviteToPortal: z.boolean().default(false),
})
export type RegisterPatientRequest = z.infer<typeof RegisterPatientRequest>

export const UpdatePatientRequest = PatientInput
export type UpdatePatientRequest = z.infer<typeof UpdatePatientRequest>

export const DuplicateCheckRequest = z.object({
  firstName: requiredText(80),
  lastName: requiredText(80),
  dateOfBirth: nullableLocalDate,
  nationalId: nullableText(40),
  contact: z.object({ phone: nullableText(32), email: nullableEmail }),
  /** When editing, the patient being edited is not their own duplicate. */
  excludePatientId: z.string().max(64).nullable().default(null),
})
export type DuplicateCheckRequest = z.infer<typeof DuplicateCheckRequest>

export const DUPLICATE_REASONS = [
  'NATIONAL_ID',
  'PHONE',
  'EMAIL',
  'NAME_AND_DATE_OF_BIRTH',
] as const
export const DuplicateReason = z.enum(DUPLICATE_REASONS)
export type DuplicateReason = z.infer<typeof DuplicateReason>

export const DuplicateCandidate = z.object({
  id: z.string(),
  medicalRecordNo: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  dateOfBirth: z.string().nullable(),
  phone: z.string().nullable(),
  isActive: z.boolean(),
  reasons: z.array(DuplicateReason),
})
export type DuplicateCandidate = z.infer<typeof DuplicateCandidate>

export const DuplicateCheckResult = z.object({ candidates: z.array(DuplicateCandidate) })
export type DuplicateCheckResult = z.infer<typeof DuplicateCheckResult>

export const PatientListQuery = PaginationQuery.extend({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['active', 'archived']).default('active'),
})
export type PatientListQuery = z.infer<typeof PatientListQuery>

export const PatientSummary = z.object({
  id: z.string(),
  medicalRecordNo: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  dateOfBirth: z.string().nullable(),
  gender: Gender.nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  isActive: z.boolean(),
  hasPortalAccount: z.boolean(),
  updatedAt: z.string().datetime().nullable(),
})
export type PatientSummary = z.infer<typeof PatientSummary>

export const PatientDetail = z.object({
  id: z.string(),
  medicalRecordNo: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  dateOfBirth: z.string().nullable(),
  gender: Gender.nullable(),
  nationalId: z.string().nullable(),
  bloodType: BloodType,
  contact: z.object({ phone: z.string().nullable(), email: z.string().nullable() }),
  address: z.object({
    line1: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string().nullable(),
  }),
  emergencyContacts: z.array(
    z.object({ name: z.string(), relationship: z.string().nullable(), phone: z.string() }),
  ),
  /** The chart banner (D4), embedded on the record so it is never a second request. */
  allergies: z.array(Allergy),
  chronicConditions: z.array(ChronicCondition),
  adminNotes: z.string().nullable(),
  isActive: z.boolean(),
  portalAccount: z.object({ userId: z.string(), status: UserStatus }).nullable(),
  createdAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime().nullable(),
  createdBy: PersonRef.nullable(),
})
export type PatientDetail = z.infer<typeof PatientDetail>
