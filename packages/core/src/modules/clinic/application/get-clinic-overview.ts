import type { ClinicOverview } from '@clinic/contracts'
import { NotFoundError } from '../../../errors'
import { assertCan, type Actor } from '../../access'
import { clinicRepository } from '../infrastructure/clinic.repository'

/**
 * Orchestration only: no driver, no HTTP, no React. The same function serves the
 * web page, the REST endpoint the mobile app will call, and any background job.
 */
export async function getClinicOverview(actor: Actor): Promise<ClinicOverview> {
  await assertCan(actor, 'clinic:read')

  const clinic = await clinicRepository.findById(actor.clinicId)
  if (!clinic) throw new NotFoundError(`Clinic ${actor.clinicId}`)

  const counts = await clinicRepository.countMembers(actor.clinicId)

  return {
    id: clinic.id,
    name: clinic.name,
    timezone: clinic.timezone,
    currency: clinic.currency,
    locale: clinic.locale,
    branches: clinic.branches,
    counts,
  }
}
