import { DentalQuickPickModel, DentalTreatmentModel, newId } from '@clinic/db'
import type { DentalScope, DentalSymbol, ToothRecordStatus, ToothSurface } from '@clinic/config'
import type { DefaultTreatment } from '../domain/defaults'

export interface StoredTreatment {
  id: string
  code: string
  name: string
  symbol: DentalSymbol
  scope: DentalScope
  serviceId: string | null
  sortOrder: number
  isActive: boolean
}

interface TreatmentRow {
  _id: string
  code: string
  name: string
  symbol: DentalSymbol
  scope: DentalScope
  serviceId?: string | null
  sortOrder?: number | null
  isActive?: boolean | null
}

const toTreatment = (doc: TreatmentRow): StoredTreatment => ({
  id: doc._id,
  code: doc.code,
  name: doc.name,
  symbol: doc.symbol,
  scope: doc.scope,
  serviceId: doc.serviceId ?? null,
  sortOrder: doc.sortOrder ?? 0,
  isActive: doc.isActive ?? true,
})

export interface StoredQuickPick {
  id: string
  doctorId: string | null
  name: string
  items: Array<{ treatmentId: string; surfaces: ToothSurface[]; status: ToothRecordStatus }>
  sortOrder: number
  isActive: boolean
}

interface QuickPickRow {
  _id: string
  doctorId?: string | null
  name: string
  items?: Array<{
    treatmentId: string
    surfaces?: ToothSurface[] | null
    status: ToothRecordStatus
  }>
  sortOrder?: number | null
  isActive?: boolean | null
}

const toQuickPick = (doc: QuickPickRow): StoredQuickPick => ({
  id: doc._id,
  doctorId: doc.doctorId ?? null,
  name: doc.name,
  items: (doc.items ?? []).map((item) => ({
    treatmentId: item.treatmentId,
    surfaces: [...(item.surfaces ?? [])],
    status: item.status,
  })),
  sortOrder: doc.sortOrder ?? 0,
  isActive: doc.isActive ?? true,
})

type TreatmentFields = Omit<StoredTreatment, 'id'>
type QuickPickFields = Omit<StoredQuickPick, 'id' | 'doctorId'>

const DUPLICATE_KEY = 11000
const isDuplicateKey = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY

export const catalogueRepository = {
  /** A clinic's treatments, in its own order. Bounded: tens of rows, not thousands. */
  async listTreatments(clinicId: string): Promise<StoredTreatment[]> {
    const docs = (await DentalTreatmentModel()
      .find({ clinicId })
      .sort({ sortOrder: 1, name: 1, _id: 1 })
      .lean()) as unknown as TreatmentRow[]
    return docs.map(toTreatment)
  },

  async findTreatment(clinicId: string, treatmentId: string): Promise<StoredTreatment | null> {
    const doc = (await DentalTreatmentModel()
      .findOne({ clinicId, _id: treatmentId })
      .lean()) as unknown as TreatmentRow | null
    return doc ? toTreatment(doc) : null
  },

  async findTreatments(
    clinicId: string,
    treatmentIds: readonly string[],
  ): Promise<Map<string, StoredTreatment>> {
    const docs = (await DentalTreatmentModel()
      .find({ clinicId, _id: { $in: [...treatmentIds] } })
      .lean()) as unknown as TreatmentRow[]
    return new Map(docs.map((doc) => [doc._id, toTreatment(doc)]))
  },

  /**
   * Writes the starting treatments a clinic does not have yet. Upserts keyed on the code, so two
   * first visits to the chart at once cannot seed it twice, and a clinic that renamed "Caries" to
   * "Decay" keeps its name.
   */
  async seedTreatments(clinicId: string, defaults: readonly DefaultTreatment[]): Promise<void> {
    await DentalTreatmentModel().bulkWrite(
      defaults.map((treatment, index) => ({
        updateOne: {
          filter: { clinicId, code: treatment.code },
          update: {
            $setOnInsert: {
              _id: newId(),
              clinicId,
              ...treatment,
              serviceId: null,
              sortOrder: (index + 1) * 10,
              isActive: true,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    )
  },

  /** Null when the code is already taken in this clinic. */
  async createTreatment(
    clinicId: string,
    fields: TreatmentFields,
  ): Promise<StoredTreatment | null> {
    try {
      const doc = await DentalTreatmentModel().create({ _id: newId(), clinicId, ...fields })
      return toTreatment(doc.toObject() as unknown as TreatmentRow)
    } catch (error) {
      if (isDuplicateKey(error)) return null
      throw error
    }
  },

  /** Null when the treatment does not exist; 'DUPLICATE' when the new code is taken. */
  async updateTreatment(
    clinicId: string,
    treatmentId: string,
    fields: TreatmentFields,
  ): Promise<StoredTreatment | null | 'DUPLICATE'> {
    try {
      const doc = (await DentalTreatmentModel()
        .findOneAndUpdate({ clinicId, _id: treatmentId }, { $set: fields }, { new: true })
        .lean()) as unknown as TreatmentRow | null
      return doc ? toTreatment(doc) : null
    } catch (error) {
      if (isDuplicateKey(error)) return 'DUPLICATE'
      throw error
    }
  },

  /** The clinic's presets and this doctor's own. Bounded: a toolbar's worth. */
  async listQuickPicks(clinicId: string, doctorId: string | null): Promise<StoredQuickPick[]> {
    const docs = (await DentalQuickPickModel()
      .find({ clinicId, doctorId: doctorId ? { $in: [null, doctorId] } : null })
      .sort({ sortOrder: 1, name: 1, _id: 1 })
      .lean()) as unknown as QuickPickRow[]
    return docs.map(toQuickPick)
  },

  async findQuickPick(clinicId: string, quickPickId: string): Promise<StoredQuickPick | null> {
    const doc = (await DentalQuickPickModel()
      .findOne({ clinicId, _id: quickPickId })
      .lean()) as unknown as QuickPickRow | null
    return doc ? toQuickPick(doc) : null
  },

  async createQuickPick(clinicId: string, fields: QuickPickFields): Promise<StoredQuickPick> {
    const doc = await DentalQuickPickModel().create({
      _id: newId(),
      clinicId,
      doctorId: null,
      ...fields,
    })
    return toQuickPick(doc.toObject() as unknown as QuickPickRow)
  },

  async updateQuickPick(
    clinicId: string,
    quickPickId: string,
    fields: QuickPickFields,
  ): Promise<StoredQuickPick | null> {
    const doc = (await DentalQuickPickModel()
      .findOneAndUpdate({ clinicId, _id: quickPickId }, { $set: fields }, { new: true })
      .lean()) as unknown as QuickPickRow | null
    return doc ? toQuickPick(doc) : null
  },
}
