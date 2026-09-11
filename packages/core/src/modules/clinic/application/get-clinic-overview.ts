import type { ClinicOverview } from '@clinic/contracts'
import { NotFoundError } from '../../../errors'
import { clinicRepository } from '../infrastructure/clinic.repository'

/**
 * Orchestration only: no driver, no HTTP, no React. The same function serves the
 * web page, the REST endpoint the mobile app will call, and any background job.
 */
export async function getClinicOverview(clinicId: string): Promise<ClinicOverview> {
  const clinic = await clinicRepository.findById(clinicId)
  if (!clinic) throw new NotFoundError(`Clinic ${clinicId}`)

  const counts = await clinicRepository.countMembers(clinicId)

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
