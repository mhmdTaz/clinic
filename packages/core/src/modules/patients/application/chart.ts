import type {
  Allergy,
  ChartBanner,
  ChronicCondition,
  SetAllergiesRequest,
  SetConditionsRequest,
} from '@clinic/contracts'
import { NotFoundError } from '../../../errors'
import { assertCan, type Actor } from '../../access'
import { patientRepository, type StoredPatient } from '../infrastructure/patient.repository'
import { patientResource } from './scope'

/**
 * The chart banner (D4): what a clinician must see before anything else, because it is the part
 * that prevents harm. It lives on the patient document rather than in its own collection, so
 * opening a chart is one read and the banner has no second way to fail to appear (section 8.6).
 *
 * Both lists are replaced whole. An allergy list is edited as a list — "these are the things
 * this person reacts to" — and a partial write is how a list ends up saying something nobody
 * meant.
 */
export function toChartBanner(patient: StoredPatient): ChartBanner {
  return {
    allergies: patient.allergies.map((allergy): Allergy => ({
      id: allergy.id,
      substance: allergy.substance,
      reaction: allergy.reaction,
      severity: allergy.severity as Allergy['severity'],
      notedAt: allergy.notedAt ? allergy.notedAt.toISOString() : null,
    })),
    chronicConditions: patient.chronicConditions.map((condition): ChronicCondition => ({
      id: condition.id,
      code: condition.code,
      description: condition.description,
      diagnosedAt: condition.diagnosedAt,
      resolvedAt: condition.resolvedAt,
    })),
  }
}

async function loadWritable(actor: Actor, patientId: string): Promise<void> {
  const facts = await patientRepository.findAccessFacts(actor.clinicId, patientId)
  if (!facts) throw new NotFoundError('Patient')
  // Clinical history is written by whoever may write the record it belongs to.
  await assertCan(actor, 'patient:update', patientResource(actor, facts.id, facts.userId))
}

export async function getChartBanner(actor: Actor, patientId: string): Promise<ChartBanner> {
  const facts = await patientRepository.findAccessFacts(actor.clinicId, patientId)
  if (!facts) throw new NotFoundError('Patient')
  await assertCan(actor, 'patient:read', patientResource(actor, facts.id, facts.userId))

  const patient = await patientRepository.findById(actor.clinicId, patientId)
  if (!patient) throw new NotFoundError('Patient')
  return toChartBanner(patient)
}

export async function setAllergies(
  actor: Actor,
  patientId: string,
  input: SetAllergiesRequest,
  now: Date = new Date(),
): Promise<ChartBanner> {
  await loadWritable(actor, patientId)
  const updated = await patientRepository.setAllergies(
    actor.clinicId,
    patientId,
    input.allergies.map((allergy) => ({
      substance: allergy.substance,
      reaction: allergy.reaction,
      severity: allergy.severity,
      notedAt: now,
    })),
    { id: actor.userId, name: actor.displayName },
  )
  if (!updated) throw new NotFoundError('Patient')
  return toChartBanner(updated)
}

export async function setChronicConditions(
  actor: Actor,
  patientId: string,
  input: SetConditionsRequest,
): Promise<ChartBanner> {
  await loadWritable(actor, patientId)
  const updated = await patientRepository.setChronicConditions(
    actor.clinicId,
    patientId,
    input.conditions.map((condition) => ({
      code: condition.code,
      description: condition.description,
      diagnosedAt: condition.diagnosedAt,
      resolvedAt: condition.resolvedAt,
    })),
    { id: actor.userId, name: actor.displayName },
  )
  if (!updated) throw new NotFoundError('Patient')
  return toChartBanner(updated)
}
