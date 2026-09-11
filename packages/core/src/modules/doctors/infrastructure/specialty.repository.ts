import { SpecialtyModel, newId } from '@clinic/db'
import { ConflictError } from '../../../errors'

export interface StoredSpecialty {
  id: string
  name: string
  isActive: boolean
}

interface SpecialtyRecord {
  _id: string
  name: string
  isActive?: boolean | null
}

const toSpecialty = (doc: SpecialtyRecord): StoredSpecialty => ({
  id: doc._id,
  name: doc.name,
  isActive: doc.isActive ?? true,
})

const isDuplicateKey = (error: unknown) => (error as { code?: unknown } | null)?.code === 11000

const nameTaken = () =>
  new ConflictError('SPECIALTY_EXISTS', 'A specialty with this name already exists.', [
    { field: 'name', issue: 'SPECIALTY_EXISTS' },
  ])

/** A clinic's own vocabulary: tens of entries, read whole. */
export const specialtyRepository = {
  async list(clinicId: string): Promise<StoredSpecialty[]> {
    const docs = await SpecialtyModel().find({ clinicId }).sort({ 'search.name': 1 }).lean()
    return (docs as unknown as SpecialtyRecord[]).map(toSpecialty)
  },

  async findByIds(clinicId: string, ids: readonly string[]): Promise<StoredSpecialty[]> {
    if (ids.length === 0) return []
    const docs = await SpecialtyModel()
      .find({ clinicId, _id: { $in: [...ids] } })
      .lean()
    return (docs as unknown as SpecialtyRecord[]).map(toSpecialty)
  },

  async create(clinicId: string, name: string): Promise<StoredSpecialty> {
    try {
      const doc = await SpecialtyModel().create({ _id: newId(), clinicId, name, isActive: true })
      return toSpecialty(doc.toObject() as unknown as SpecialtyRecord)
    } catch (error) {
      if (isDuplicateKey(error)) throw nameTaken()
      throw error
    }
  },

  async update(
    clinicId: string,
    id: string,
    patch: { name: string; isActive: boolean },
  ): Promise<StoredSpecialty | null> {
    try {
      const doc = await SpecialtyModel()
        .findOneAndUpdate({ clinicId, _id: id }, { $set: patch }, { new: true })
        .lean()
      return doc ? toSpecialty(doc as unknown as SpecialtyRecord) : null
    } catch (error) {
      if (isDuplicateKey(error)) throw nameTaken()
      throw error
    }
  },
}
