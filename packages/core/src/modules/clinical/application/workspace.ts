import type {
  EncounterDetail,
  OpenEncounterRequest,
  SetDiagnosesRequest,
  UpdateEncounterRequest,
  VitalsInput,
} from '@clinic/contracts'
import { BusinessRuleError, NotFoundError, ValidationError } from '../../../errors'
import { assertCan, type Actor } from '../../access'
import { findPatientForScheduling } from '../../patients'
import { findDoctorForScheduling } from '../../doctors'
import { isIcd10Code, withOnePrimary } from '../domain/encounter'
import { encounterRepository } from '../infrastructure/encounter.repository'
import { toEncounterDetail } from './directory'
import { encounterResource } from './scope'

/**
 * The doctor's encounter workspace (D6, D7). Everything here writes to an OPEN encounter whose
 * note is still a DRAFT; the moment it is signed this file can no longer change a word of it,
 * which is the point of ADR-0024 and not an accident of where the code lives.
 */

function detail(encounter: Parameters<typeof toEncounterDetail>[0]): EncounterDetail {
  // Everything in this file is done by someone who may write the note, so they may read it.
  return toEncounterDetail(encounter, { includeNote: true })
}

async function loadWritable(actor: Actor, encounterId: string) {
  const facts = await encounterRepository.findAccessFacts(actor.clinicId, encounterId)
  if (!facts) throw new NotFoundError('Encounter')
  await assertCan(
    actor,
    'encounter:write',
    encounterResource(actor, {
      id: facts.id,
      patientId: facts.patientId,
      doctorId: facts.doctorId,
    }),
  )
  return facts
}

/**
 * A write that matched nothing hit one of two closed doors, and they are fixed differently: a
 * signed note takes an addendum, a cancelled visit takes nothing. The facts are re-read rather
 * than reused, because the door may have closed while this request was in flight.
 */
async function refuseClosed(actor: Actor, encounterId: string): Promise<never> {
  const facts = await encounterRepository.findAccessFacts(actor.clinicId, encounterId)
  if (!facts) throw new NotFoundError('Encounter')
  if (facts.noteStatus === 'SIGNED') {
    throw new BusinessRuleError(
      'NOTE_ALREADY_SIGNED',
      'This note has been signed. Add an addendum instead.',
    )
  }
  throw new BusinessRuleError('ENCOUNTER_CANCELLED', 'This visit was cancelled.')
}

/**
 * Opening a visit (D6). An appointment may have only one encounter: a second one would split the
 * record of a single visit in two, and neither half would be the truth.
 */
export async function openEncounter(
  actor: Actor,
  input: OpenEncounterRequest,
  now: Date = new Date(),
): Promise<EncounterDetail> {
  await assertCan(actor, 'encounter:write')
  if (!actor.doctorId) {
    throw new BusinessRuleError(
      'NO_DOCTOR_PROFILE',
      'Only a doctor with a profile at this clinic can open a visit.',
    )
  }

  const [patient, doctor] = await Promise.all([
    findPatientForScheduling(actor.clinicId, input.patientId),
    findDoctorForScheduling(actor.clinicId, actor.doctorId),
  ])
  if (!patient) throw new NotFoundError('Patient')
  if (!doctor) throw new NotFoundError('Doctor')
  if (!patient.isActive) {
    throw new BusinessRuleError('PATIENT_ARCHIVED', 'That patient record is archived.')
  }

  if (input.appointmentId) {
    const existing = await encounterRepository.findByAppointment(
      actor.clinicId,
      input.appointmentId,
    )
    if (existing) {
      throw new BusinessRuleError(
        'ENCOUNTER_EXISTS',
        'That appointment already has a visit recorded against it.',
      )
    }
  }

  const encounter = await encounterRepository.create({
    clinicId: actor.clinicId,
    number: await encounterRepository.nextNumber(actor.clinicId),
    patientId: patient.id,
    doctorId: actor.doctorId,
    appointmentId: input.appointmentId,
    patient: {
      name: patient.name,
      medicalRecordNo: patient.medicalRecordNo,
      dateOfBirth: patient.dateOfBirth ?? null,
    },
    doctor: { name: doctor.name },
    encounterType: input.encounterType,
    chiefComplaint: input.chiefComplaint,
    startedAt: now,
    createdBy: { id: actor.userId, name: actor.displayName },
  })
  return detail(encounter)
}

/**
 * Writing the note. The draft precondition is in the update's filter, so a note signed between
 * the permission check and the write is not written to — there is no window to lose (8.15).
 */
export async function updateEncounter(
  actor: Actor,
  encounterId: string,
  input: UpdateEncounterRequest,
): Promise<EncounterDetail> {
  await loadWritable(actor, encounterId)

  /** What the note says. Only a draft accepts any of it. */
  const content: Record<string, unknown> = {}
  if (input.encounterType !== undefined) content.encounterType = input.encounterType
  if (input.chiefComplaint !== undefined) content.chiefComplaint = input.chiefComplaint
  for (const [section, value] of Object.entries(input.note ?? {})) {
    if (value !== undefined) content[`note.${section}`] = value
  }

  /** Who may read it. Not a claim about what it says, so a signed note still accepts this: a
   * clinic can decide to share a note with the patient the day after it was written. */
  const sharing: Record<string, unknown> =
    input.isNoteVisibleToPatient === undefined
      ? {}
      : { 'note.isPatientVisible': input.isNoteVisibleToPatient }

  if (Object.keys(content).length === 0 && Object.keys(sharing).length === 0) {
    throw new ValidationError('Nothing to update.', [
      { field: '(body)', issue: 'NOTHING_TO_UPDATE' },
    ])
  }

  if (Object.keys(content).length === 0) {
    const shared = await encounterRepository.updateOpen(actor.clinicId, encounterId, sharing)
    if (!shared) throw new NotFoundError('Encounter')
    return detail(shared)
  }

  const updated = await encounterRepository.updateDraft(actor.clinicId, encounterId, {
    ...content,
    ...sharing,
  })
  if (!updated) return refuseClosed(actor, encounterId)
  return detail(updated)
}

/** Vitals are measurements taken during the visit, so they close when the visit does. */
export async function recordVitals(
  actor: Actor,
  encounterId: string,
  input: VitalsInput,
  now: Date = new Date(),
): Promise<EncounterDetail> {
  await loadWritable(actor, encounterId)

  const updated = await encounterRepository.updateDraft(actor.clinicId, encounterId, {
    vitals: {
      ...input,
      recordedAt: now,
      recordedBy: { id: actor.userId, name: actor.displayName },
    },
  })
  if (!updated) return refuseClosed(actor, encounterId)
  return detail(updated)
}

/** The coded assessment (D7). Replaced as a set, because "which one is primary" is a property
 * of the list rather than of any one row. */
export async function setDiagnoses(
  actor: Actor,
  encounterId: string,
  input: SetDiagnosesRequest,
): Promise<EncounterDetail> {
  await loadWritable(actor, encounterId)

  const malformed = input.diagnoses
    .map((diagnosis, index) => ({ diagnosis, index }))
    .filter(({ diagnosis }) => !isIcd10Code(diagnosis.code))
  if (malformed.length > 0) {
    throw new ValidationError('Some diagnosis codes are not ICD-10.', [
      ...malformed.map(({ index }) => ({
        field: `diagnoses.${index}.code`,
        issue: 'INVALID_ICD10_CODE',
      })),
    ])
  }

  const updated = await encounterRepository.updateDraft(actor.clinicId, encounterId, {
    diagnoses: withOnePrimary(input.diagnoses).map((diagnosis) => ({
      ...diagnosis,
      code: diagnosis.code.trim().toUpperCase(),
      codeSystem: 'ICD10',
    })),
  })
  if (!updated) return refuseClosed(actor, encounterId)
  return detail(updated)
}

/**
 * Closing the visit. Deliberately separate from signing the note: a doctor may finish seeing the
 * patient and write the note up afterwards, which is what actually happens in a clinic.
 */
export async function completeEncounter(
  actor: Actor,
  encounterId: string,
  now: Date = new Date(),
): Promise<EncounterDetail> {
  await loadWritable(actor, encounterId)
  const completed = await encounterRepository.complete(actor.clinicId, encounterId, now)
  if (!completed) {
    throw new BusinessRuleError('ENCOUNTER_CLOSED', 'This visit has already been closed.')
  }
  return detail(completed)
}
