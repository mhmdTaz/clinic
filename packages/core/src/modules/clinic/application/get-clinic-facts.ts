import { NotFoundError } from '../../../errors'
import type { Clinic } from '../domain/clinic'
import { clinicRepository } from '../infrastructure/clinic.repository'

/**
 * Currency, timezone and branches, for another module's rules — a fee needs the currency, a
 * doctor needs the branches. No permission check: it answers a use case, never a person.
 */
export async function getClinicFacts(clinicId: string): Promise<Clinic> {
  const clinic = await clinicRepository.findById(clinicId)
  if (!clinic) throw new NotFoundError(`Clinic ${clinicId}`)
  return clinic
}

/**
 * The clinic's own letterhead: what every document it issues is printed with (D8).
 *
 * No permission check, because it is not about anybody — it is the clinic's name and how to
 * reach it, which is on the door. A patient downloading their own prescription must not need
 * `clinic:read` for the header of it to render.
 */
export interface ClinicLetterhead {
  name: string
  timezone: string
  phone: string | null
  email: string | null
}

export async function getClinicLetterhead(clinicId: string): Promise<ClinicLetterhead> {
  const profile = await clinicRepository.findProfile(clinicId)
  if (!profile) throw new NotFoundError(`Clinic ${clinicId}`)
  return {
    name: profile.name,
    timezone: profile.timezone,
    phone: profile.contact.phone,
    email: profile.contact.email,
  }
}
