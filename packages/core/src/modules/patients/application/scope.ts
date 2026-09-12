import { ForbiddenError } from '../../../errors'
import { assertCan, careRelationship, registerScopeResolver, type Actor } from '../../access'

/**
 * OWN on a patient reaches the record linked to the actor's own portal account.
 *
 * ASSIGNED is the case ADR-0004 had to be amended for in Phase 4: a patient row names no doctor,
 * so read literally a doctor could open nobody. A patient is reachable when the doctor is named
 * on one of that patient's visits — a question authorisation asks and the clinical module
 * answers, through a port the composition root wires. The chart's *contents* stay strict per
 * row, which is what chart-wide scope was rejected to protect.
 */
export function installPatientScopeResolvers(): void {
  registerScopeResolver('patient', async (actor, resource, scope) => {
    if (scope === 'OWN') {
      return typeof resource.userId === 'string' && resource.userId === actor.userId
    }
    if (scope === 'ASSIGNED') {
      const patientId = typeof resource.id === 'string' ? resource.id : null
      if (!actor.doctorId || !patientId) return false
      return careRelationship().hasTreated(actor.clinicId, actor.doctorId, patientId)
    }
    return false
  })
}

export const patientResource = (actor: Actor, patientId: string | null, userId: string | null) => ({
  clinicId: actor.clinicId,
  type: 'Patient',
  id: patientId,
  userId,
})

/**
 * Reading other people's records — duplicate candidates, the whole directory — needs patient:read
 * across the clinic. A narrower grant is refused through the engine, so the denial is audited.
 */
export async function assertClinicWidePatientRead(actor: Actor): Promise<void> {
  await assertCan(actor, 'patient:read')
  const scope = actor.permissions.get('patient:read')
  if (scope === 'CLINIC' || scope === 'GLOBAL') return
  await assertCan(actor, 'patient:read', patientResource(actor, null, null))
  throw new ForbiddenError('patient:read')
}

/** The list filter a patient:read grant compiles to (section 7.5). */
export async function patientListScope(actor: Actor): Promise<{ userId?: string }> {
  await assertCan(actor, 'patient:read')
  const scope = actor.permissions.get('patient:read')
  if (scope === 'CLINIC' || scope === 'GLOBAL') return {}
  if (scope === 'OWN') return { userId: actor.userId }
  await assertClinicWidePatientRead(actor)
  return {}
}
