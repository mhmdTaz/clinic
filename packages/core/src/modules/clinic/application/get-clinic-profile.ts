import { localDateIn, type ClinicProfile } from '@clinic/contracts'
import { NotFoundError } from '../../../errors'
import { assertCan, type Actor } from '../../access'
import { upcomingHolidays } from '../domain/clinic'
import { clinicRepository } from '../infrastructure/clinic.repository'

/** Contact details, opening hours and the next closures — what any portal may show. */
export async function getClinicProfile(
  actor: Actor,
  now: Date = new Date(),
): Promise<ClinicProfile> {
  await assertCan(actor, 'clinic:read')
  const record = await clinicRepository.findProfile(actor.clinicId)
  if (!record) throw new NotFoundError(`Clinic ${actor.clinicId}`)

  const { holidays, ...profile } = record
  return {
    ...profile,
    upcomingHolidays: upcomingHolidays(holidays, localDateIn(profile.timezone, now)),
  }
}
