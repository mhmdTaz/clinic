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
  /** What the clinic is called on a tax document, when that differs from its trading name. */
  legalName: string | null
  taxId: string | null
  timezone: string
  currency: string
  phone: string | null
  email: string | null
  /** The postal address, already reduced to the lines a document prints. */
  addressLines: string[]
}

export async function getClinicLetterhead(clinicId: string): Promise<ClinicLetterhead> {
  const settings = await clinicRepository.findSettings(clinicId)
  if (!settings) throw new NotFoundError(`Clinic ${clinicId}`)
  return {
    name: settings.name,
    legalName: settings.legalName,
    taxId: settings.taxId,
    timezone: settings.timezone,
    currency: settings.currency,
    phone: settings.contact.phone,
    email: settings.contact.email,
    addressLines: [
      settings.address.line1,
      settings.address.line2,
      [settings.address.city, settings.address.country].filter(Boolean).join(', ') || null,
    ].filter((line): line is string => Boolean(line)),
  }
}
