import { registerScopeResolver, type Actor, type ScopeResolver } from '../../access'

/** OWN on a doctor reaches the profile attached to the actor's own account (D2). */
const ownProfile: ScopeResolver = (actor, resource, scope) =>
  scope === 'OWN' && typeof resource.userId === 'string' && resource.userId === actor.userId

export function installDoctorScopeResolvers(): void {
  registerScopeResolver('doctor', ownProfile)
  // A doctor's week and days away live on the same document and answer the same question, so
  // `availability:*` at OWN resolves the same way. Registering it is not optional: the policy
  // fails closed, so a scopable permission with no resolver would deny a doctor their own
  // schedule (section 7.5).
  registerScopeResolver('availability', ownProfile)
}

export const doctorResource = (actor: Actor, doctorId: string | null, userId: string | null) => ({
  clinicId: actor.clinicId,
  type: 'Doctor',
  id: doctorId,
  userId,
})
