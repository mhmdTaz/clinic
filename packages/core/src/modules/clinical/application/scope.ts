import { ForbiddenError } from '../../../errors'
import { assertCan, registerScopeResolver, type Actor, type PermissionKey } from '../../access'

/**
 * Who reaches a visit (section 7.5, ADR-0004).
 *
 * ASSIGNED is **strict** here, and this is the row that ADR-0004 was written about: a doctor
 * reaches the encounters they conducted, and not a colleague's notes on the same patient. Being
 * able to open the patient does not open the patient's whole chart — that was the reading the
 * ADR rejected, because it would let one appointment booked by the front desk quietly widen what
 * a doctor can read, with nothing in the roles editor to show it.
 */
export function installEncounterScopeResolvers(): void {
  registerScopeResolver('encounter', (actor, resource, scope) => {
    if (scope === 'ASSIGNED') {
      return Boolean(actor.doctorId) && resource.doctorId === actor.doctorId
    }
    if (scope === 'OWN') {
      return Boolean(actor.patientId) && resource.patientId === actor.patientId
    }
    return false
  })
}

export const encounterResource = (
  actor: Actor,
  encounter: { id: string | null; patientId: string | null; doctorId: string | null },
) => ({
  clinicId: actor.clinicId,
  type: 'Encounter',
  id: encounter.id,
  patientId: encounter.patientId,
  doctorId: encounter.doctorId,
})

export interface EncounterScopeFilter {
  doctorId?: string
  patientId?: string
  /** A patient sees the visit, and the note only where it was shared and signed (ADR-0025). */
  patientVisibleOnly?: boolean
}

export async function encounterListScope(
  actor: Actor,
  permission: PermissionKey = 'encounter:read',
): Promise<EncounterScopeFilter> {
  await assertCan(actor, permission)
  const scope = actor.permissions.get(permission)
  if (scope === 'CLINIC' || scope === 'GLOBAL') return {}
  if (scope === 'ASSIGNED') {
    if (!actor.doctorId) throw new ForbiddenError(permission)
    return { doctorId: actor.doctorId }
  }
  if (scope === 'OWN') {
    if (!actor.patientId) throw new ForbiddenError(permission)
    return { patientId: actor.patientId }
  }
  throw new ForbiddenError(permission)
}

/** Whether this actor reads charts across the clinic, or only their own corner of them. */
export function readsWholeClinic(actor: Actor): boolean {
  const scope = actor.permissions.get('encounter:read')
  return scope === 'CLINIC' || scope === 'GLOBAL'
}

/** A patient reading their own record — the one audience the note is redacted for. */
export function readsAsPatient(actor: Actor): boolean {
  return actor.permissions.get('encounter:read') === 'OWN'
}
