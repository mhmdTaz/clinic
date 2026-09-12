import { ServiceModel, newId } from '@clinic/db'

/** Mongoose hands back a Decimal128; the catalogue speaks in the decimal strings a price is. */
type Decimalish = { toString(): string } | string | number | null | undefined

const decimal = (value: Decimalish, fallback: string): string =>
  value === null || value === undefined ? fallback : String(value)

export interface StoredService {
  id: string
  name: string
  description: string | null
  price: string
  taxRatePercent: string
  durationMinutes: number | null
  isActive: boolean
}

export interface ServiceWrite {
  name: string
  description: string | null
  price: string
  taxRatePercent: string
  durationMinutes: number | null
  isActive: boolean
}

interface ServiceRecord {
  _id: string
  name: string
  description?: string | null
  price?: Decimalish
  taxRatePercent?: Decimalish
  durationMinutes?: number | null
  isActive?: boolean
}

const toService = (doc: ServiceRecord): StoredService => ({
  id: doc._id,
  name: doc.name,
  description: doc.description ?? null,
  price: decimal(doc.price, '0'),
  taxRatePercent: decimal(doc.taxRatePercent, '0'),
  durationMinutes: doc.durationMinutes ?? null,
  isActive: doc.isActive ?? true,
})

export const serviceRepository = {
  async create(clinicId: string, input: ServiceWrite): Promise<StoredService> {
    const doc = await ServiceModel().create({ _id: newId(), clinicId, ...input })
    return toService(doc.toObject() as ServiceRecord)
  },

  async update(
    clinicId: string,
    serviceId: string,
    input: Partial<ServiceWrite>,
  ): Promise<StoredService | null> {
    // Loaded and saved rather than patched, so the audit plugin records a field-level diff of
    // exactly what changed — a price rise is the kind of edit somebody asks about later.
    const doc = await ServiceModel().findOne({ clinicId, _id: serviceId })
    if (!doc) return null
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) doc.set(key, value)
    }
    await doc.save()
    return toService(doc.toObject() as ServiceRecord)
  },

  async findById(clinicId: string, serviceId: string): Promise<StoredService | null> {
    const doc = (await ServiceModel()
      .findOne({ clinicId, _id: serviceId })
      .lean()) as ServiceRecord | null
    return doc ? toService(doc) : null
  },

  async findMany(clinicId: string, serviceIds: string[]): Promise<StoredService[]> {
    if (serviceIds.length === 0) return []
    const docs = (await ServiceModel()
      .find({ clinicId, _id: { $in: serviceIds } })
      .lean()) as ServiceRecord[]
    return docs.map(toService)
  },

  async list(clinicId: string, status: 'active' | 'inactive' | 'all'): Promise<StoredService[]> {
    const filter: Record<string, unknown> = { clinicId }
    if (status !== 'all') filter.isActive = status === 'active'
    // Sorted on the folded key, which is what the index holds: "X-ray" and "x-ray" sort
    // together rather than an ASCII code point apart.
    const docs = (await ServiceModel()
      .find(filter)
      .sort({ 'search.name': 1 })
      .lean()) as ServiceRecord[]
    return docs.map(toService)
  },
}
