import { normalizeAmount } from '@clinic/contracts'
import type { Service, ServiceInput, ServiceListQuery } from '@clinic/contracts'
import { ConflictError, NotFoundError, ValidationError } from '../../../errors'
import { assertCan, type Actor } from '../../access'
import { getClinicFacts } from '../../clinic'
import { serviceRepository, type StoredService } from '../infrastructure/service.repository'

const toService = (service: StoredService, currency: string): Service => ({
  id: service.id,
  name: service.name,
  description: service.description,
  price: service.price,
  taxRatePercent: service.taxRatePercent,
  durationMinutes: service.durationMinutes,
  isActive: service.isActive,
  currency,
})

/** A MongoDB duplicate-key error, whatever wrapper it arrives in. */
const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000

/**
 * A price the clinic's currency can actually express. "45.005" dollars is not a price anyone
 * can pay, and accepting it would push the rounding decision onto whoever renders the invoice.
 */
function assertPayablePrice(price: string, currency: string): string {
  const normalized = normalizeAmount(price, currency)
  if (normalized === null) {
    throw new ValidationError('That price is not valid for this clinic’s currency.', [
      { field: 'price', issue: 'INVALID_AMOUNT' },
    ])
  }
  return normalized
}

export async function listServices(actor: Actor, query: ServiceListQuery): Promise<Service[]> {
  await assertCan(actor, 'service:read')
  const [clinic, services] = await Promise.all([
    getClinicFacts(actor.clinicId),
    serviceRepository.list(actor.clinicId, query.status),
  ])
  return services.map((service) => toService(service, clinic.currency))
}

export async function createService(actor: Actor, input: ServiceInput): Promise<Service> {
  await assertCan(actor, 'service:manage')
  const clinic = await getClinicFacts(actor.clinicId)
  const price = assertPayablePrice(input.price, clinic.currency)

  try {
    const service = await serviceRepository.create(actor.clinicId, { ...input, price })
    return toService(service, clinic.currency)
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new ConflictError('SERVICE_EXISTS', 'A service with that name already exists.', [
        { field: 'name', issue: 'DUPLICATE' },
      ])
    }
    throw error
  }
}

/**
 * Editing the catalogue. It changes what the next invoice starts from and nothing about the
 * invoices already drawn — their lines are snapshots taken when they were written (section 8.2).
 */
export async function updateService(
  actor: Actor,
  serviceId: string,
  input: ServiceInput,
): Promise<Service> {
  await assertCan(actor, 'service:manage')
  const clinic = await getClinicFacts(actor.clinicId)
  const price = assertPayablePrice(input.price, clinic.currency)

  try {
    const service = await serviceRepository.update(actor.clinicId, serviceId, { ...input, price })
    if (!service) throw new NotFoundError('Service')
    return toService(service, clinic.currency)
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new ConflictError('SERVICE_EXISTS', 'A service with that name already exists.', [
        { field: 'name', issue: 'DUPLICATE' },
      ])
    }
    throw error
  }
}

/** For invoicing: the catalogue rows an invoice's lines are being drawn from. */
export async function findServicesForInvoicing(
  clinicId: string,
  serviceIds: string[],
): Promise<Map<string, StoredService>> {
  const services = await serviceRepository.findMany(clinicId, serviceIds)
  return new Map(services.map((service) => [service.id, service]))
}
