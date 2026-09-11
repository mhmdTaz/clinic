import type { ClinicProfile } from '@clinic/contracts'
import { NotFoundError } from '../../../errors'
import { assertCan, type Actor } from '../../access'
import { clinicRepository } from '../infrastructure/clinic.repository'

/** Contact details and opening hours — what any portal may show about the clinic. */
export async function getClinicProfile(actor: Actor): Promise<ClinicProfile> {
  await assertCan(actor, 'clinic:read')
  const profile = await clinicRepository.findProfile(actor.clinicId)
  if (!profile) throw new NotFoundError(`Clinic ${actor.clinicId}`)
  return profile
}
