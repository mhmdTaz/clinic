import { registerScopeResolver, type Actor } from '../../access'

/**
 * Who reaches a prescription (section 7.5). Strict, like every other clinical row: the doctor
 * who wrote it, and the patient it was written for (ADR-0004).
 */
export function installPrescriptionScopeResolvers(): void {
  registerScopeResolver('prescription', (actor, resource, scope) => {
    if (scope === 'ASSIGNED') {
      return Boolean(actor.doctorId) && resource.doctorId === actor.doctorId
    }
    if (scope === 'OWN') {
      return Boolean(actor.patientId) && resource.patientId === actor.patientId
    }
    return false
  })
}

export const prescriptionResource = (
  actor: Actor,
  prescription: { id: string | null; patientId: string | null; doctorId: string | null },
) => ({
  clinicId: actor.clinicId,
  type: 'Prescription',
  id: prescription.id,
  patientId: prescription.patientId,
  doctorId: prescription.doctorId,
})
