import { registerScopeResolver, type Actor } from '../../access'

/** OWN on a doctor reaches the profile attached to the actor's own account (D2). */
export function installDoctorScopeResolvers(): void {
  registerScopeResolver(
    'doctor',
    (actor, resource, scope) =>
      scope === 'OWN' && typeof resource.userId === 'string' && resource.userId === actor.userId,
  )
}

export const doctorResource = (actor: Actor, doctorId: string | null, userId: string | null) => ({
  clinicId: actor.clinicId,
  type: 'Doctor',
  id: doctorId,
  userId,
})
