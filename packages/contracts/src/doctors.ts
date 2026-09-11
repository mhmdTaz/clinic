import { z } from 'zod'
import { EmailAddress } from './auth'
import {
  Money,
  MoneyAmount,
  SlotMinutes,
  UserStatus,
  blankToNull,
  nullableInteger,
  nullableText,
  requiredText,
} from './common'

/** Doctor onboarding and the specialty vocabulary (S3, section 9.3). */

export const DoctorProfileInput = z.object({
  title: nullableText(20),
  licenseNumber: nullableText(40),
  specialtyIds: z.array(z.string().min(1).max(64)).max(5),
  consultationFee: z.preprocess(blankToNull, MoneyAmount.nullable()),
  defaultSlotMinutes: SlotMinutes,
  yearsOfExperience: nullableInteger(0, 70),
  bio: nullableText(1500),
  isAcceptingNew: z.boolean(),
  /** Where the doctor practises. Ignored while the clinic has a single branch (ADR-0021). */
  branchIds: z.array(z.string().min(1).max(64)).max(20).default([]),
})
export type DoctorProfileInput = z.infer<typeof DoctorProfileInput>

export const CreateDoctorRequest = DoctorProfileInput.extend({
  firstName: requiredText(80),
  lastName: requiredText(80),
  email: EmailAddress,
  phone: nullableText(32),
})
export type CreateDoctorRequest = z.infer<typeof CreateDoctorRequest>

export const UpdateDoctorRequest = DoctorProfileInput.extend({
  firstName: requiredText(80),
  lastName: requiredText(80),
  phone: nullableText(32),
  isActive: z.boolean(),
})
export type UpdateDoctorRequest = z.infer<typeof UpdateDoctorRequest>

export const DoctorListQuery = z.object({
  q: z.string().trim().max(80).optional(),
  specialtyId: z.string().max(64).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
})
export type DoctorListQuery = z.infer<typeof DoctorListQuery>

export const SpecialtyRef = z.object({ id: z.string(), name: z.string() })

export const DoctorSummary = z.object({
  id: z.string(),
  userId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  displayName: z.string(),
  title: z.string().nullable(),
  email: z.string(),
  phone: z.string().nullable(),
  specialties: z.array(SpecialtyRef),
  consultationFee: Money.nullable(),
  defaultSlotMinutes: z.number().int(),
  isAcceptingNew: z.boolean(),
  isActive: z.boolean(),
  accountStatus: UserStatus,
})
export type DoctorSummary = z.infer<typeof DoctorSummary>

export const DoctorDetail = DoctorSummary.extend({
  licenseNumber: z.string().nullable(),
  bio: z.string().nullable(),
  yearsOfExperience: z.number().int().nullable(),
  branchIds: z.array(z.string()),
  createdAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime().nullable(),
})
export type DoctorDetail = z.infer<typeof DoctorDetail>

export const Specialty = z.object({
  id: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  doctorCount: z.number().int(),
})
export type Specialty = z.infer<typeof Specialty>

export const CreateSpecialtyRequest = z.object({ name: requiredText(60) })
export type CreateSpecialtyRequest = z.infer<typeof CreateSpecialtyRequest>

export const UpdateSpecialtyRequest = z.object({ name: requiredText(60), isActive: z.boolean() })
export type UpdateSpecialtyRequest = z.infer<typeof UpdateSpecialtyRequest>
