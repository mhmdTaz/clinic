import { LabOrderModel, newId } from '@clinic/db'
import type { DentalSymbol, LabOrderStatus } from '@clinic/config'
import type { PersonRef } from '@clinic/contracts'
import {
  decodeCursor,
  keysetAfter,
  pageFrom,
  sortFor,
  type Page,
  type SortKey,
} from '../../../pagination'

export interface LabHistoryEntry {
  status: LabOrderStatus
  at: Date
  by: PersonRef | null
  note: string | null
  dueOn: string | null
}

export interface StoredLabOrder {
  id: string
  patientId: string
  patient: { name: string; medicalRecordNo: string }
  toothRecordIds: string[]
  teeth: string[]
  work: Array<{ name: string; symbol: DentalSymbol }>
  labName: string
  sentOn: string
  dueOn: string
  status: LabOrderStatus
  notes: string | null
  history: LabHistoryEntry[]
  createdBy: PersonRef | null
  createdAt: Date
}

type PersonRow = { id?: string | null; name?: string | null } | null | undefined

interface LabOrderRow {
  _id: string
  patientId: string
  patient?: { name?: string; medicalRecordNo?: string } | null
  toothRecordIds?: string[] | null
  teeth?: string[] | null
  work?: Array<{ name: string; symbol: DentalSymbol }> | null
  labName: string
  sentOn: string
  dueOn: string
  status?: LabOrderStatus | null
  notes?: string | null
  history?: Array<{
    status: LabOrderStatus
    at: Date
    by?: PersonRow
    note?: string | null
    dueOn?: string | null
  }> | null
  createdBy?: PersonRow
  createdAt?: Date | null
}

const person = (value: PersonRow) =>
  value?.name ? { id: value.id ?? null, name: value.name } : null

const toOrder = (doc: LabOrderRow): StoredLabOrder => ({
  id: doc._id,
  patientId: doc.patientId,
  patient: {
    name: doc.patient?.name ?? '',
    medicalRecordNo: doc.patient?.medicalRecordNo ?? '',
  },
  toothRecordIds: [...(doc.toothRecordIds ?? [])],
  teeth: [...(doc.teeth ?? [])],
  work: (doc.work ?? []).map((entry) => ({ name: entry.name, symbol: entry.symbol })),
  labName: doc.labName,
  sentOn: doc.sentOn,
  dueOn: doc.dueOn,
  status: doc.status ?? 'SENT',
  notes: doc.notes ?? null,
  history: (doc.history ?? []).map((entry) => ({
    status: entry.status,
    at: entry.at,
    by: person(entry.by),
    note: entry.note ?? null,
    dueOn: entry.dueOn ?? null,
  })),
  createdBy: person(doc.createdBy),
  createdAt: doc.createdAt ?? new Date(0),
})

const NEWEST_FIRST: readonly SortKey[] = [
  { field: 'createdAt', direction: -1, kind: 'date' },
  { field: '_id', direction: -1, kind: 'string' },
]

/** The lab board reads the soonest due first: what is late, then what is due next. */
const SOONEST_DUE: readonly SortKey[] = [
  { field: 'dueOn', direction: 1, kind: 'string' },
  { field: '_id', direction: 1, kind: 'string' },
]

const OPEN: readonly LabOrderStatus[] = ['SENT', 'REMAKE', 'RECEIVED']
const AT_LAB: readonly LabOrderStatus[] = ['SENT', 'REMAKE']

export const labOrderRepository = {
  async create(input: {
    clinicId: string
    patientId: string
    patient: { name: string; medicalRecordNo: string }
    toothRecordIds: string[]
    teeth: string[]
    work: Array<{ name: string; symbol: DentalSymbol }>
    labName: string
    sentOn: string
    dueOn: string
    notes: string | null
    createdBy: PersonRef
    at: Date
  }): Promise<StoredLabOrder> {
    const { at, ...fields } = input
    const doc = await LabOrderModel().create({
      _id: newId(),
      ...fields,
      status: 'SENT',
      history: [{ status: 'SENT', at, by: input.createdBy, note: input.notes, dueOn: input.dueOn }],
    })
    return toOrder(doc.toObject() as unknown as LabOrderRow)
  },

  async findById(clinicId: string, orderId: string): Promise<StoredLabOrder | null> {
    const doc = (await LabOrderModel()
      .findOne({ clinicId, _id: orderId })
      .lean()) as unknown as LabOrderRow | null
    return doc ? toOrder(doc) : null
  },

  async listForPatient(
    clinicId: string,
    patientId: string,
    filter: { open?: boolean },
    page: { cursor?: string; limit: number },
  ): Promise<Page<StoredLabOrder>> {
    const where: Record<string, unknown> = { clinicId, patientId }
    if (filter.open) where.status = { $in: [...OPEN] }
    if (page.cursor) {
      where.$and = [keysetAfter(NEWEST_FIRST, decodeCursor(page.cursor, NEWEST_FIRST.length))]
    }
    const docs = (await LabOrderModel()
      .find(where)
      .sort(sortFor(NEWEST_FIRST))
      .limit(page.limit + 1)
      .lean()) as unknown as Array<LabOrderRow & Record<string, unknown>>
    const { docs: rows, nextCursor } = pageFrom(docs, page.limit, NEWEST_FIRST)
    return { items: rows.map(toOrder), nextCursor }
  },

  /** The clinic's lab board. With no status, what is not finished with; `lateBefore` keeps the late. */
  async list(
    clinicId: string,
    filter: { status?: LabOrderStatus; lateBefore?: string },
    page: { cursor?: string; limit: number },
  ): Promise<Page<StoredLabOrder>> {
    const where: Record<string, unknown> = { clinicId }
    if (filter.lateBefore) {
      where.status = filter.status ? filter.status : { $in: [...AT_LAB] }
      where.dueOn = { $lt: filter.lateBefore }
    } else {
      where.status = filter.status ?? { $in: [...OPEN] }
    }
    if (page.cursor) {
      where.$and = [keysetAfter(SOONEST_DUE, decodeCursor(page.cursor, SOONEST_DUE.length))]
    }
    const docs = (await LabOrderModel()
      .find(where)
      .sort(sortFor(SOONEST_DUE))
      .limit(page.limit + 1)
      .lean()) as unknown as Array<LabOrderRow & Record<string, unknown>>
    const { docs: rows, nextCursor } = pageFrom(docs, page.limit, SOONEST_DUE)
    return { items: rows.map(toOrder), nextCursor }
  },

  /** Work still at the lab, for these patients — what tomorrow's appointments may be waiting on. */
  async atLabFor(clinicId: string, patientIds: readonly string[]): Promise<StoredLabOrder[]> {
    if (patientIds.length === 0) return []
    const docs = (await LabOrderModel()
      .find({ clinicId, patientId: { $in: [...patientIds] }, status: { $in: [...AT_LAB] } })
      .setOptions({ skipAudit: true })
      .lean()) as unknown as LabOrderRow[]
    return docs.map(toOrder)
  },

  /** A patient's open orders, soonest due first: the tooth drawer's lab chips. Bounded by a mouth. */
  async openForPatient(clinicId: string, patientId: string): Promise<StoredLabOrder[]> {
    const docs = (await LabOrderModel()
      .find({ clinicId, patientId, status: { $in: [...OPEN] } })
      .sort({ dueOn: 1 })
      .lean()) as unknown as LabOrderRow[]
    return docs.map(toOrder)
  },

  /**
   * Moves an order on. The expected status is in the filter, so two people taking the same crown
   * in at once cannot both write a history line: the second finds nothing to move.
   */
  async move(
    clinicId: string,
    orderId: string,
    from: LabOrderStatus,
    entry: LabHistoryEntry,
  ): Promise<StoredLabOrder | null> {
    const set: Record<string, unknown> = { status: entry.status }
    if (entry.dueOn) set.dueOn = entry.dueOn
    const doc = (await LabOrderModel()
      .findOneAndUpdate(
        { clinicId, _id: orderId, status: from },
        { $set: set, $push: { history: entry } },
        { new: true },
      )
      .lean()) as unknown as LabOrderRow | null
    return doc ? toOrder(doc) : null
  },
}
