import { z } from 'zod'
import {
  IdParam,
  LocalDate,
  PersonRef,
  blankToNull,
  nullableInteger,
  nullableLocalDate,
  nullableText,
  requiredText,
} from './common'

/**
 * Contracts for the clinical record (section 8.8): a visit, the note written during it, what was
 * measured, and what it was decided to be.
 *
 * The note is the reason most of this is shaped the way it is. Until it is signed it is a draft
 * the doctor owns; after signing it is evidence, and the only way to change the record is to add
 * to it (D9, ADR-0024).
 */

export const EncounterStatus = z.enum(['OPEN', 'COMPLETED', 'CANCELLED'])
export type EncounterStatus = z.infer<typeof EncounterStatus>

export const EncounterType = z.enum([
  'CONSULTATION',
  'FOLLOW_UP',
  'PROCEDURE',
  'EMERGENCY',
  'TELEHEALTH',
])
export type EncounterType = z.infer<typeof EncounterType>

export const NoteStatus = z.enum(['DRAFT', 'SIGNED'])
export type NoteStatus = z.infer<typeof NoteStatus>

export const AllergySeverity = z.enum(['MILD', 'MODERATE', 'SEVERE', 'UNKNOWN'])
export type AllergySeverity = z.infer<typeof AllergySeverity>

/**
 * A measurement as a decimal string, like money: "36.6", "72.4". A JSON number would arrive as
 * a float, and a float is the wrong shape for something a clinician wrote down.
 */
const measurement = (maxWhole: number) =>
  z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .regex(/^\d{1,3}(\.\d)?$/, 'INVALID_MEASUREMENT')
      .refine((value) => Number(value) <= maxWhole, 'TOO_LARGE')
      .nullable(),
  )

// ── The visit ────────────────────────────────────────────────────────────────

/**
 * A visit is opened from an appointment wherever there is one, so the chart and the diary agree
 * about what happened. An encounter with no appointment is a walk-in the desk never recorded.
 */
export const OpenEncounterRequest = z.object({
  patientId: IdParam,
  appointmentId: z.string().max(64).nullable().default(null),
  encounterType: EncounterType.default('CONSULTATION'),
  chiefComplaint: nullableText(300),
})
export type OpenEncounterRequest = z.infer<typeof OpenEncounterRequest>

/** Every part of the note is optional while it is a draft: a doctor writes in the order they think. */
export const NoteInput = z.object({
  subjective: nullableText(5000),
  objective: nullableText(5000),
  assessment: nullableText(5000),
  plan: nullableText(5000),
})
export type NoteInput = z.infer<typeof NoteInput>

export const UpdateEncounterRequest = z.object({
  encounterType: EncounterType.optional(),
  chiefComplaint: nullableText(300).optional(),
  note: NoteInput.partial().optional(),
  /** What the patient may read of the note once it is signed (ADR-0025). */
  isNoteVisibleToPatient: z.boolean().optional(),
})
export type UpdateEncounterRequest = z.infer<typeof UpdateEncounterRequest>

export const VitalsInput = z.object({
  heightCm: measurement(300),
  weightKg: measurement(700),
  temperatureC: measurement(45),
  systolicMmHg: nullableInteger(40, 300),
  diastolicMmHg: nullableInteger(20, 200),
  heartRateBpm: nullableInteger(20, 300),
  respiratoryRate: nullableInteger(4, 80),
  oxygenSaturation: nullableInteger(50, 100),
  bloodGlucose: measurement(100),
})
export type VitalsInput = z.infer<typeof VitalsInput>

export const Vitals = VitalsInput.extend({
  recordedAt: z.string().datetime().nullable(),
  recordedBy: PersonRef.nullable(),
})
export type Vitals = z.infer<typeof Vitals>

export const DiagnosisInput = z.object({
  code: requiredText(16),
  description: requiredText(200),
  isPrimary: z.boolean().default(false),
  isChronic: z.boolean().default(false),
  notes: nullableText(500),
})
export type DiagnosisInput = z.infer<typeof DiagnosisInput>

export const Diagnosis = DiagnosisInput.extend({ id: z.string(), codeSystem: z.string() })
export type Diagnosis = z.infer<typeof Diagnosis>

/** At most one diagnosis is primary; the server decides, so two screens cannot disagree. */
export const SetDiagnosesRequest = z.object({ diagnoses: z.array(DiagnosisInput).max(20) })
export type SetDiagnosesRequest = z.infer<typeof SetDiagnosesRequest>

/** Signing is a claim about content, so the content is what is hashed (ADR-0024). */
export const SignNoteRequest = z.object({
  /** Typed by the doctor as a deliberate act. Their own name, as it will be printed. */
  signature: requiredText(120),
})
export type SignNoteRequest = z.infer<typeof SignNoteRequest>

export const AddendumRequest = z.object({ body: requiredText(2000) })
export type AddendumRequest = z.infer<typeof AddendumRequest>

export const Addendum = z.object({
  id: z.string(),
  body: z.string(),
  author: PersonRef.nullable(),
  createdAt: z.string().datetime().nullable(),
})
export type Addendum = z.infer<typeof Addendum>

export const ClinicalNote = z.object({
  subjective: z.string().nullable(),
  objective: z.string().nullable(),
  assessment: z.string().nullable(),
  plan: z.string().nullable(),
  status: NoteStatus,
  isPatientVisible: z.boolean(),
  signedAt: z.string().datetime().nullable(),
  signedBy: PersonRef.nullable(),
  addenda: z.array(Addendum),
})
export type ClinicalNote = z.infer<typeof ClinicalNote>

export const EncounterSummary = z.object({
  id: z.string(),
  number: z.string(),
  status: EncounterStatus,
  encounterType: EncounterType,
  chiefComplaint: z.string().nullable(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  patient: z.object({ id: z.string(), name: z.string(), medicalRecordNo: z.string() }),
  doctor: z.object({ id: z.string(), name: z.string() }),
  appointmentId: z.string().nullable(),
  noteStatus: NoteStatus,
  diagnoses: z.array(Diagnosis),
})
export type EncounterSummary = z.infer<typeof EncounterSummary>

export const EncounterDetail = EncounterSummary.extend({
  note: ClinicalNote,
  vitals: Vitals.nullable(),
  createdBy: PersonRef.nullable(),
})
export type EncounterDetail = z.infer<typeof EncounterDetail>

export const EncounterListQuery = z.object({
  patientId: z.string().max(64).optional(),
  doctorId: z.string().max(64).optional(),
  status: EncounterStatus.optional(),
  from: LocalDate.optional(),
  to: LocalDate.optional(),
})
export type EncounterListQuery = z.infer<typeof EncounterListQuery>

// ── The chart banner (D4) ────────────────────────────────────────────────────

export const AllergyInput = z.object({
  substance: requiredText(120),
  reaction: nullableText(200),
  severity: AllergySeverity.default('UNKNOWN'),
})
export type AllergyInput = z.infer<typeof AllergyInput>

export const Allergy = AllergyInput.extend({
  id: z.string(),
  notedAt: z.string().datetime().nullable(),
})
export type Allergy = z.infer<typeof Allergy>

export const ChronicConditionInput = z.object({
  code: nullableText(16),
  description: requiredText(200),
  diagnosedAt: nullableLocalDate,
  resolvedAt: nullableLocalDate,
})
export type ChronicConditionInput = z.infer<typeof ChronicConditionInput>

export const ChronicCondition = ChronicConditionInput.extend({ id: z.string() })
export type ChronicCondition = z.infer<typeof ChronicCondition>

export const SetAllergiesRequest = z.object({ allergies: z.array(AllergyInput).max(50) })
export type SetAllergiesRequest = z.infer<typeof SetAllergiesRequest>

export const SetConditionsRequest = z.object({
  conditions: z.array(ChronicConditionInput).max(50),
})
export type SetConditionsRequest = z.infer<typeof SetConditionsRequest>

/** What the chart shows before anything else, because it is the part that prevents harm. */
export const ChartBanner = z.object({
  allergies: z.array(Allergy),
  chronicConditions: z.array(ChronicCondition),
})
export type ChartBanner = z.infer<typeof ChartBanner>
