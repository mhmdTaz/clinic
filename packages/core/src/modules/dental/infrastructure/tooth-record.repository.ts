import { ToothRecordModel, newId } from '@clinic/db'
import type {
  DentalScope,
  DentalSymbol,
  ToothRecordStatus,
  ToothRole,
  ToothSurface,
} from '@clinic/config'
import type { PersonRef } from '@clinic/contracts'
import {
  decodeCursor,
  keysetAfter,
  pageFrom,
  sortFor,
  type Page,
  type SortKey,
} from '../../../pagination'
import { sessionOf, type Transaction } from '../../../transaction'

export interface StoredToothRecord {
  id: string
  patientId: string
  encounterId: string | null
  teeth: Array<{ fdi: string; role: ToothRole | null }>
  surfaces: ToothSurface[]
  treatmentId: string
  treatment: { code: string; name: string; symbol: DentalSymbol; scope: DentalScope }
  status: ToothRecordStatus
  completesRecordId: string | null
  notes: string | null
  performedOn: string
  doctorId: string | null
  doctor: PersonRef | null
  recordedBy: PersonRef | null
  createdAt: Date
  voidedAt: Date | null
  voidedBy: PersonRef | null
  voidReason: string | null
}

interface ToothRecordRow {
  _id: string
  patientId: string
  encounterId?: string | null
  teeth?: Array<{ fdi: string; role?: ToothRole | null }> | null
  surfaces?: ToothSurface[] | null
  treatmentId: string
  treatment: { code: string; name: string; symbol: DentalSymbol; scope: DentalScope }
  status: ToothRecordStatus
  completesRecordId?: string | null
  notes?: string | null
  performedOn: string
  doctorId?: string | null
  doctor?: { id?: string | null; name?: string | null } | null
  recordedBy?: { id?: string | null; name?: string | null } | null
  createdAt?: Date | null
  voidedAt?: Date | null
  voidedBy?: { id?: string | null; name?: string | null } | null
  voidReason?: string | null
}

const person = (value: { id?: string | null; name?: string | null } | null | undefined) =>
  value?.name ? { id: value.id ?? null, name: value.name } : null

function toRecord(doc: ToothRecordRow): StoredToothRecord {
  return {
    id: doc._id,
    patientId: doc.patientId,
    encounterId: doc.encounterId ?? null,
    teeth: (doc.teeth ?? []).map((tooth) => ({ fdi: tooth.fdi, role: tooth.role ?? null })),
    surfaces: [...(doc.surfaces ?? [])],
    treatmentId: doc.treatmentId,
    treatment: {
      code: doc.treatment.code,
      name: doc.treatment.name,
      symbol: doc.treatment.symbol,
      scope: doc.treatment.scope,
    },
    status: doc.status,
    completesRecordId: doc.completesRecordId ?? null,
    notes: doc.notes ?? null,
    performedOn: doc.performedOn,
    doctorId: doc.doctorId ?? null,
    doctor: person(doc.doctor),
    recordedBy: person(doc.recordedBy),
    createdAt: doc.createdAt ?? new Date(0),
    voidedAt: doc.voidedAt ?? null,
    voidedBy: person(doc.voidedBy),
    voidReason: doc.voidReason ?? null,
  }
}

/** A tooth's timeline and the drawer read newest first; the chart reads the other way. */
const TIMELINE_ORDER: readonly SortKey[] = [
  { field: 'performedOn', direction: -1, kind: 'string' },
  { field: 'createdAt', direction: -1, kind: 'date' },
  { field: '_id', direction: -1, kind: 'string' },
]

export interface NewToothRecord {
  clinicId: string
  patientId: string
  encounterId: string | null
  teeth: Array<{ fdi: string; role: ToothRole | null }>
  surfaces: ToothSurface[]
  treatmentId: string
  treatment: { code: string; name: string; symbol: DentalSymbol; scope: DentalScope }
  status: ToothRecordStatus
  completesRecordId: string | null
  notes: string | null
  performedOn: string
  doctorId: string | null
  doctor: PersonRef | null
  recordedBy: PersonRef
}

export const toothRecordRepository = {
  async create(input: NewToothRecord): Promise<StoredToothRecord> {
    const doc = await ToothRecordModel().create({ _id: newId(), ...input })
    return toRecord(doc.toObject() as unknown as ToothRecordRow)
  },

  /** Several rows at once — a quick-pick is one act, and lands as one write or none. */
  async createMany(
    inputs: readonly NewToothRecord[],
    tx?: Transaction,
  ): Promise<StoredToothRecord[]> {
    if (inputs.length === 0) return []
    const docs = await ToothRecordModel().insertMany(
      inputs.map((input) => ({ _id: newId(), ...input })),
      { ordered: true, session: sessionOf(tx) },
    )
    return docs.map((doc) => toRecord(doc.toObject() as unknown as ToothRecordRow))
  },

  async findById(clinicId: string, recordId: string): Promise<StoredToothRecord | null> {
    const doc = (await ToothRecordModel()
      .findOne({ clinicId, _id: recordId })
      .lean()) as unknown as ToothRecordRow | null
    return doc ? toRecord(doc) : null
  },

  /** Who a row belongs to, for an access decision. Not a view of the chart. */
  async findAccessFacts(
    clinicId: string,
    recordId: string,
  ): Promise<{ id: string; patientId: string } | null> {
    const doc = (await ToothRecordModel()
      .findOne({ clinicId, _id: recordId })
      .select({ patientId: 1 })
      .setOptions({ skipAudit: true })
      .lean()) as unknown as { _id: string; patientId: string } | null
    return doc ? { id: doc._id, patientId: doc.patientId } : null
  },

  /**
   * Every row of one patient's chart, oldest first — what the picture is derived from.
   *
   * Bounded by one mouth over one lifetime at one clinic: in practice a few hundred rows, and the
   * projection leaves the notes behind, which are the only large field.
   */
  async listForChart(clinicId: string, patientId: string): Promise<StoredToothRecord[]> {
    const docs = (await ToothRecordModel()
      .find({ clinicId, patientId })
      .select({ notes: 0 })
      .sort({ performedOn: 1, createdAt: 1, _id: 1 })
      .lean()) as unknown as ToothRecordRow[]
    return docs.map(toRecord)
  },

  async list(
    clinicId: string,
    filter: {
      patientId: string
      tooth?: string
      status?: ToothRecordStatus
      doctorId?: string
      encounterId?: string
      from?: string
      to?: string
      includeVoided?: boolean
    },
    page: { cursor?: string; limit: number },
  ): Promise<Page<StoredToothRecord>> {
    const where: Record<string, unknown> = { clinicId, patientId: filter.patientId }
    if (filter.tooth) where['teeth.fdi'] = filter.tooth
    if (filter.status) where.status = filter.status
    if (filter.doctorId) where.doctorId = filter.doctorId
    if (filter.encounterId) where.encounterId = filter.encounterId
    if (!filter.includeVoided) where.voidedAt = null
    if (filter.from || filter.to) {
      where.performedOn = {
        ...(filter.from ? { $gte: filter.from } : {}),
        ...(filter.to ? { $lte: filter.to } : {}),
      }
    }
    if (page.cursor) {
      where.$and = [keysetAfter(TIMELINE_ORDER, decodeCursor(page.cursor, TIMELINE_ORDER.length))]
    }

    const docs = (await ToothRecordModel()
      .find(where)
      .sort(sortFor(TIMELINE_ORDER))
      .limit(page.limit + 1)
      .lean()) as unknown as Array<ToothRecordRow & Record<string, unknown>>
    const { docs: rows, nextCursor } = pageFrom(docs, page.limit, TIMELINE_ORDER)
    return { items: rows.map(toRecord), nextCursor }
  },

  /** For each planned row asked about, the live row that carried it out, if there is one. */
  async completionsOf(
    clinicId: string,
    plannedIds: readonly string[],
  ): Promise<Map<string, string>> {
    if (plannedIds.length === 0) return new Map()
    const docs = (await ToothRecordModel()
      .find({ clinicId, completesRecordId: { $in: [...plannedIds] }, voidedAt: null })
      .select({ completesRecordId: 1 })
      .setOptions({ skipAudit: true })
      .lean()) as unknown as Array<{ _id: string; completesRecordId: string }>
    return new Map(docs.map((doc) => [doc.completesRecordId, doc._id]))
  },

  /**
   * Voids a row once. The precondition is in the filter, so two people voiding the same row at
   * once cannot both succeed and the second reason cannot overwrite the first.
   */
  async void(
    clinicId: string,
    recordId: string,
    input: { by: PersonRef; reason: string; at: Date },
  ): Promise<StoredToothRecord | null> {
    const doc = (await ToothRecordModel()
      .findOneAndUpdate(
        { clinicId, _id: recordId, voidedAt: null },
        { $set: { voidedAt: input.at, voidedBy: input.by, voidReason: input.reason } },
        { new: true },
      )
      .lean()) as unknown as ToothRecordRow | null
    return doc ? toRecord(doc) : null
  },
}
