import { NotFoundError } from '../../../errors'
import {
  assertCan,
  careRelationship,
  registerScopeResolver,
  type Actor,
  type PermissionKey,
} from '../../access'
import { findPatientForCharting, type PatientDentalFacts } from '../../patients'

/**
 * Who reaches a patient's tooth chart (ADR-0035).
 *
 * The chart is one picture of one mouth, not a set of visit notes, so ASSIGNED is patient-wide:
 * a doctor who has treated the patient sees every tooth's whole history, a colleague's work
 * included. That is the rule for documents too, and it is deliberately wider than a visit's note
 * (ADR-0004) — a dentist who cannot see that 16 already has a root canal is a danger, not a
 * privacy win. OWN is the patient's own chart, for when the portal shows it.
 */
export function installDentalScopeResolvers(): void {
  registerScopeResolver('dental', async (actor, resource, scope) => {
    const patientId = typeof resource.patientId === 'string' ? resource.patientId : null
    if (!patientId) return false
    if (scope === 'OWN') return Boolean(actor.patientId) && patientId === actor.patientId
    if (scope === 'ASSIGNED') {
      if (!actor.doctorId) return false
      return careRelationship().hasTreated(actor.clinicId, actor.doctorId, patientId)
    }
    return false
  })
}

export const dentalResource = (actor: Actor, patientId: string) => ({
  clinicId: actor.clinicId,
  type: 'ToothChart',
  patientId,
})

/** The patient, once the caller may do `permission` on their chart. */
export async function patientForChart(
  actor: Actor,
  patientId: string,
  permission: Extract<PermissionKey, 'dental:read' | 'dental:write'>,
): Promise<PatientDentalFacts> {
  const patient = await findPatientForCharting(actor.clinicId, patientId)
  if (!patient) throw new NotFoundError('Patient')
  await assertCan(actor, permission, dentalResource(actor, patient.id))
  return patient
}
