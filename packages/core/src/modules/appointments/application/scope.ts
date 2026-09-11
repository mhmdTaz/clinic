import { ForbiddenError } from '../../../errors'
import { assertCan, registerScopeResolver, type Actor, type PermissionKey } from '../../access'

/**
 * ASSIGNED reaches the appointments naming the actor's own doctor profile; OWN reaches the
 * patient's own (ADR-0004). An actor with no such profile resolves to nothing — a missing
 * profile must deny, never open.
 */
export function installAppointmentScopeResolvers(): void {
  registerScopeResolver('appointment', (actor, resource, scope) => {
    if (scope === 'ASSIGNED') {
      return Boolean(actor.doctorId) && resource.doctorId === actor.doctorId
    }
    if (scope === 'OWN') {
      return Boolean(actor.patientId) && resource.patientId === actor.patientId
    }
    return false
  })
}

export const appointmentResource = (
  actor: Actor,
  appointment: { id: string | null; doctorId: string | null; patientId: string | null },
) => ({
  clinicId: actor.clinicId,
  type: 'Appointment',
  id: appointment.id,
  doctorId: appointment.doctorId,
  patientId: appointment.patientId,
})

export interface AppointmentScopeFilter {
  doctorId?: string
  patientId?: string
}

/**
 * The filter a grant compiles to (section 7.5), so a list never loads rows the actor may not
 * see and then hides them.
 */
export async function appointmentListScope(
  actor: Actor,
  permission: PermissionKey = 'appointment:read',
): Promise<AppointmentScopeFilter> {
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

/** Whether this actor sees the whole clinic's calendar, or only their own corner of it. */
export function readsWholeClinic(actor: Actor): boolean {
  const scope = actor.permissions.get('appointment:read')
  return scope === 'CLINIC' || scope === 'GLOBAL'
}
