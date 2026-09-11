import type { ClinicSessionInfo } from '../domain/clinic'
import { clinicRepository } from '../infrastructure/clinic.repository'

/**
 * Read on every authenticated request, so a permission change is seen on the very next
 * one (section 7.7). Deliberately uncached: it is a single primary-key read.
 *
 * A missing clinic is a deployment fault, not a user error, so it throws a plain Error
 * that is logged loudly rather than a 404 that would look like a routing problem.
 */
export async function getClinicSessionInfo(clinicId: string): Promise<ClinicSessionInfo> {
  const info = await clinicRepository.findSessionInfo(clinicId)
  if (!info) {
    throw new Error(
      `The installation clinic "${clinicId}" does not exist. Check CLINIC_ID, or run ` +
        '`pnpm db:migrate && pnpm db:seed` for a local environment.',
    )
  }
  return info
}
