import { ForbiddenError } from '../../../errors'
import { assertCan, registerScopeResolver, type Actor } from '../../access'

/**
 * OWN on a patient reaches the record linked to the actor's own portal account. ASSIGNED — the
 * patients a doctor treats — waits for ADR-0004 in Phase 4; until then it resolves to nothing,
 * so the engine denies, which is the safe direction (section 7.5).
 */
export function installPatientScopeResolvers(): void {
  registerScopeResolver(
    'patient',
    (actor, resource, scope) =>
      scope === 'OWN' && typeof resource.userId === 'string' && resource.userId === actor.userId,
  )
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
