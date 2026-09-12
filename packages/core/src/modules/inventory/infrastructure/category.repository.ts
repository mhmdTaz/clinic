import { InventoryCategoryModel, newId } from '@clinic/db'

export interface StoredCategory {
  id: string
  name: string
  isActive: boolean
}

interface CategoryRecord {
  _id: string
  name: string
  isActive?: boolean
}

const toCategory = (doc: CategoryRecord): StoredCategory => ({
  id: doc._id,
  name: doc.name,
  isActive: doc.isActive ?? true,
})

export const categoryRepository = {
  async create(clinicId: string, input: { name: string; isActive: boolean }) {
    const doc = await InventoryCategoryModel().create({ _id: newId(), clinicId, ...input })
    return toCategory(doc.toObject() as CategoryRecord)
  },

  async update(clinicId: string, categoryId: string, input: { name: string; isActive: boolean }) {
    const doc = await InventoryCategoryModel().findOne({ clinicId, _id: categoryId })
    if (!doc) return null
    doc.set('name', input.name)
    doc.set('isActive', input.isActive)
    await doc.save()
    return toCategory(doc.toObject() as CategoryRecord)
  },

  async list(clinicId: string, status: 'active' | 'inactive' | 'all'): Promise<StoredCategory[]> {
    const filter: Record<string, unknown> = { clinicId }
    if (status !== 'all') filter.isActive = status === 'active'
    const docs = (await InventoryCategoryModel()
      .find(filter)
      .sort({ 'search.name': 1 })
      .lean()) as CategoryRecord[]
    return docs.map(toCategory)
  },
}
