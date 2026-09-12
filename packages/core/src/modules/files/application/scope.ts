import { careRelationship, registerScopeResolver, type Actor } from '../../access'

/**
 * Who reaches a stored document (section 7.5).
 *
 * OWN is a patient looking at their own vault, and it is the one place in the system where a
 * scope depends on a flag as well as an owner: a file about a patient is not automatically a
 * file *for* them. Sharing is a decision someone at the clinic takes (ADR-0025).
 *
 * ASSIGNED is a doctor reaching the documents of a patient they have treated.
 */
export function installFileScopeResolvers(): void {
  registerScopeResolver('file', async (actor, resource, scope) => {
    const patientId = typeof resource.patientId === 'string' ? resource.patientId : null

    if (scope === 'OWN') {
      return (
        Boolean(actor.patientId) &&
        patientId === actor.patientId &&
        resource.isPatientVisible === true
      )
    }
    if (scope === 'ASSIGNED') {
      if (!actor.doctorId || !patientId) return false
      return careRelationship().hasTreated(actor.clinicId, actor.doctorId, patientId)
    }
    return false
  })
}

export const fileResource = (
  actor: Actor,
  file: { id: string | null; patientId: string | null; isPatientVisible: boolean },
) => ({
  clinicId: actor.clinicId,
  type: 'File',
  id: file.id,
  patientId: file.patientId,
  isPatientVisible: file.isPatientVisible,
})

/** Whether this actor sees every document in the clinic, or only a corner of the vault. */
export function readsWholeVault(actor: Actor): boolean {
  const scope = actor.permissions.get('file:read')
  return scope === 'CLINIC' || scope === 'GLOBAL'
}

/** The filter a file:read grant compiles to, so unreachable rows are never loaded (7.5). */
export function fileListScope(
  actor: Actor,
): { patientId?: string; patientVisibleOnly?: boolean } | null {
  const scope = actor.permissions.get('file:read')
  if (scope === 'CLINIC' || scope === 'GLOBAL') return {}
  if (scope === 'OWN') {
    return actor.patientId ? { patientId: actor.patientId, patientVisibleOnly: true } : null
  }
  // ASSIGNED narrows by the patient asked for, which the use case checks row by row.
  return scope === 'ASSIGNED' ? {} : null
}
