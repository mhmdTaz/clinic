import { SupplierModel, newId } from '@clinic/db'

export interface StoredSupplier {
  id: string
  name: string
  contactName: string | null
  phone: string | null
  email: string | null
  notes: string | null
  isActive: boolean
}

export interface SupplierWrite {
  name: string
  contactName: string | null
  phone: string | null
  email: string | null
  notes: string | null
  isActive: boolean
}

interface SupplierRecord {
  _id: string
  name: string
  contactName?: string | null
  phone?: string | null
  email?: string | null
  notes?: string | null
  isActive?: boolean
}

const toSupplier = (doc: SupplierRecord): StoredSupplier => ({
  id: doc._id,
  name: doc.name,
  contactName: doc.contactName ?? null,
  phone: doc.phone ?? null,
  email: doc.email ?? null,
  notes: doc.notes ?? null,
  isActive: doc.isActive ?? true,
})

export const supplierRepository = {
  async create(clinicId: string, input: SupplierWrite): Promise<StoredSupplier> {
    const doc = await SupplierModel().create({ _id: newId(), clinicId, ...input })
    return toSupplier(doc.toObject() as SupplierRecord)
  },

  async update(
    clinicId: string,
    supplierId: string,
    input: SupplierWrite,
  ): Promise<StoredSupplier | null> {
    const doc = await SupplierModel().findOne({ clinicId, _id: supplierId })
    if (!doc) return null
    for (const [key, value] of Object.entries(input)) doc.set(key, value)
    await doc.save()
    return toSupplier(doc.toObject() as SupplierRecord)
  },

  async list(clinicId: string, status: 'active' | 'inactive' | 'all'): Promise<StoredSupplier[]> {
    const filter: Record<string, unknown> = { clinicId }
    if (status !== 'all') filter.isActive = status === 'active'
    const docs = (await SupplierModel()
      .find(filter)
      .sort({ 'search.name': 1 })
      .lean()) as SupplierRecord[]
    return docs.map(toSupplier)
  },
}
