import { TreatmentPlanModel, decimal128, newId } from '@clinic/db'
import type { DentalSymbol, ToothRole, ToothSurface, TreatmentPlanStatus } from '@clinic/config'
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
import type { PlanItemState } from '../domain/plan'

/** Mongoose hands back a Decimal128; a plan speaks in the decimal strings it was written in. */
type Decimalish = { toString(): string } | string | number | null | undefined
const decimal = (value: Decimalish, fallback = '0'): string =>
  value === null || value === undefined ? fallback : String(value)

/** A line's money, rounded once per line exactly as on an invoice (ADR-0027). */
export interface PricedLine {
  serviceId: string | null
  description: string
  quantity: string
  unitPrice: string
  discount: string
  taxRatePercent: string
  gross: string
  net: string
  tax: string
  lineTotal: string
}

export interface NewPlanItem extends PricedLine {
  toothRecordId: string
  phase: number
  teeth: Array<{ fdi: string; role: ToothRole | null }>
  surfaces: ToothSurface[]
  treatment: { id: string; code: string; name: string; symbol: DentalSymbol }
}

export interface StoredPlanItem extends NewPlanItem {
  id: string
  state: PlanItemState
  doneOn: string | null
  completedByRecordId: string | null
  completedInEncounterId: string | null
  billedInvoiceId: string | null
  billedInvoiceNumber: string | null
  billedAt: Date | null
}

export interface PlanTotals {
  subtotal: string
  discountTotal: string
  taxTotal: string
  total: string
}

export interface StoredPlan extends PlanTotals {
  id: string
  patientId: string
  title: string
  status: TreatmentPlanStatus
  phases: string[]
  items: StoredPlanItem[]
  openItems: number
  currency: string
  notes: string | null
  createdBy: PersonRef | null
  createdAt: Date
  presentedAt: Date | null
  decidedAt: Date | null
  acceptedAt: Date | null
  decisionRecordedBy: PersonRef | null
  signedBy: string | null
  signatureFileId: string | null
  declineReason: string | null
  cancelledAt: Date | null
  cancelledBy: PersonRef | null
  cancelReason: string | null
}

interface ItemRow {
  _id: string
  toothRecordId: string
  phase: number
  teeth?: Array<{ fdi: string; role?: ToothRole | null }> | null
  surfaces?: ToothSurface[] | null
  treatment: { id: string; code: string; name: string; symbol: DentalSymbol }
  serviceId?: string | null
  description: string
  quantity?: Decimalish
  unitPrice?: Decimalish
  discount?: Decimalish
  taxRatePercent?: Decimalish
  gross?: Decimalish
  net?: Decimalish
  tax?: Decimalish
  lineTotal?: Decimalish
  state?: PlanItemState | null
  doneOn?: string | null
  completedByRecordId?: string | null
  completedInEncounterId?: string | null
  billedInvoiceId?: string | null
  billedInvoiceNumber?: string | null
  billedAt?: Date | null
}

interface PlanRow {
  _id: string
  patientId: string
  title: string
  status?: TreatmentPlanStatus | null
  phases?: string[] | null
  items?: ItemRow[] | null
  openItems?: number | null
  currency: string
  subtotal?: Decimalish
  discountTotal?: Decimalish
  taxTotal?: Decimalish
  total?: Decimalish
  notes?: string | null
  createdBy?: { id?: string | null; name?: string | null } | null
  createdAt?: Date | null
  presentedAt?: Date | null
  decidedAt?: Date | null
  acceptedAt?: Date | null
  decisionRecordedBy?: { id?: string | null; name?: string | null } | null
  signedBy?: string | null
  signatureFileId?: string | null
  declineReason?: string | null
  cancelledAt?: Date | null
  cancelledBy?: { id?: string | null; name?: string | null } | null
  cancelReason?: string | null
}

const person = (value: { id?: string | null; name?: string | null } | null | undefined) =>
  value?.name ? { id: value.id ?? null, name: value.name } : null

const toItem = (row: ItemRow): StoredPlanItem => ({
  id: row._id,
  toothRecordId: row.toothRecordId,
  phase: row.phase,
  teeth: (row.teeth ?? []).map((tooth) => ({ fdi: tooth.fdi, role: tooth.role ?? null })),
  surfaces: [...(row.surfaces ?? [])],
  treatment: {
    id: row.treatment.id,
    code: row.treatment.code,
    name: row.treatment.name,
    symbol: row.treatment.symbol,
  },
  serviceId: row.serviceId ?? null,
  description: row.description,
  quantity: decimal(row.quantity, '1'),
  unitPrice: decimal(row.unitPrice),
  discount: decimal(row.discount),
  taxRatePercent: decimal(row.taxRatePercent),
  gross: decimal(row.gross),
  net: decimal(row.net),
  tax: decimal(row.tax),
  lineTotal: decimal(row.lineTotal),
  state: row.state ?? 'OPEN',
  doneOn: row.doneOn ?? null,
  completedByRecordId: row.completedByRecordId ?? null,
  completedInEncounterId: row.completedInEncounterId ?? null,
  billedInvoiceId: row.billedInvoiceId ?? null,
  billedInvoiceNumber: row.billedInvoiceNumber ?? null,
  billedAt: row.billedAt ?? null,
})

const toPlan = (row: PlanRow): StoredPlan => ({
  id: row._id,
  patientId: row.patientId,
  title: row.title,
  status: row.status ?? 'DRAFT',
  phases: [...(row.phases ?? [])],
  items: (row.items ?? []).map(toItem),
  openItems: row.openItems ?? 0,
  currency: row.currency,
  subtotal: decimal(row.subtotal),
  discountTotal: decimal(row.discountTotal),
  taxTotal: decimal(row.taxTotal),
  total: decimal(row.total),
  notes: row.notes ?? null,
  createdBy: person(row.createdBy),
  createdAt: row.createdAt ?? new Date(0),
  presentedAt: row.presentedAt ?? null,
  decidedAt: row.decidedAt ?? null,
  acceptedAt: row.acceptedAt ?? null,
  decisionRecordedBy: person(row.decisionRecordedBy),
  signedBy: row.signedBy ?? null,
  signatureFileId: row.signatureFileId ?? null,
  declineReason: row.declineReason ?? null,
  cancelledAt: row.cancelledAt ?? null,
  cancelledBy: person(row.cancelledBy),
  cancelReason: row.cancelReason ?? null,
})

const itemsFor = (items: readonly NewPlanItem[]) =>
  items.map((item) => ({
    _id: newId(),
    ...item,
    quantity: decimal128(item.quantity),
    unitPrice: decimal128(item.unitPrice),
    discount: decimal128(item.discount),
    taxRatePercent: decimal128(item.taxRatePercent),
    gross: decimal128(item.gross),
    net: decimal128(item.net),
    tax: decimal128(item.tax),
    lineTotal: decimal128(item.lineTotal),
    state: 'OPEN',
  }))

const totalsFor = (totals: PlanTotals) => ({
  subtotal: decimal128(totals.subtotal),
  discountTotal: decimal128(totals.discountTotal),
  taxTotal: decimal128(totals.taxTotal),
  total: decimal128(totals.total),
})

const NEWEST_FIRST: readonly SortKey[] = [
  { field: 'createdAt', direction: -1, kind: 'date' },
  { field: '_id', direction: -1, kind: 'string' },
]

/** The longest-waiting first: the recall list works from the top. */
const LONGEST_WAITING: readonly SortKey[] = [
  { field: 'acceptedAt', direction: 1, kind: 'date' },
  { field: '_id', direction: 1, kind: 'string' },
]

/** Where the chart says each item stands; see `syncPlansFor`. */
export interface ItemProgress {
  itemId: string
  state: PlanItemState
  doneOn: string | null
  completedByRecordId: string | null
  completedInEncounterId: string | null
}

export const treatmentPlanRepository = {
  async create(input: {
    clinicId: string
    patientId: string
    title: string
    phases: string[]
    items: NewPlanItem[]
    currency: string
    totals: PlanTotals
    notes: string | null
    createdBy: PersonRef
  }): Promise<StoredPlan> {
    const doc = await TreatmentPlanModel().create({
      _id: newId(),
      clinicId: input.clinicId,
      patientId: input.patientId,
      title: input.title,
      status: 'DRAFT',
      phases: input.phases,
      items: itemsFor(input.items),
      openItems: input.items.length,
      currency: input.currency,
      ...totalsFor(input.totals),
      notes: input.notes,
      createdBy: input.createdBy,
    })
    return toPlan(doc.toObject() as unknown as PlanRow)
  },

  async findById(clinicId: string, planId: string): Promise<StoredPlan | null> {
    const doc = (await TreatmentPlanModel()
      .findOne({ clinicId, _id: planId })
      .lean()) as unknown as PlanRow | null
    return doc ? toPlan(doc) : null
  },

  /** Whose plan it is, for an access decision. Not a view of the plan. */
  async findAccessFacts(
    clinicId: string,
    planId: string,
  ): Promise<{ id: string; patientId: string } | null> {
    const doc = (await TreatmentPlanModel()
      .findOne({ clinicId, _id: planId })
      .select({ patientId: 1 })
      .setOptions({ skipAudit: true })
      .lean()) as unknown as { _id: string; patientId: string } | null
    return doc ? { id: doc._id, patientId: doc.patientId } : null
  },

  async listForPatient(
    clinicId: string,
    patientId: string,
    filter: { status?: TreatmentPlanStatus },
    page: { cursor?: string; limit: number },
  ): Promise<Page<StoredPlan>> {
    const where: Record<string, unknown> = { clinicId, patientId }
    if (filter.status) where.status = filter.status
    if (page.cursor) {
      where.$and = [keysetAfter(NEWEST_FIRST, decodeCursor(page.cursor, NEWEST_FIRST.length))]
    }
    const docs = (await TreatmentPlanModel()
      .find(where)
      .sort(sortFor(NEWEST_FIRST))
      .limit(page.limit + 1)
      .lean()) as unknown as Array<PlanRow & Record<string, unknown>>
    const { docs: rows, nextCursor } = pageFrom(docs, page.limit, NEWEST_FIRST)
    return { items: rows.map(toPlan), nextCursor }
  },

  /** Every plan, in the given states, that has one of these chart rows as an item. */
  async findContaining(
    clinicId: string,
    toothRecordIds: readonly string[],
    statuses?: readonly TreatmentPlanStatus[],
    tx?: Transaction,
  ): Promise<StoredPlan[]> {
    if (toothRecordIds.length === 0) return []
    const where: Record<string, unknown> = {
      clinicId,
      'items.toothRecordId': { $in: [...toothRecordIds] },
    }
    if (statuses) where.status = { $in: [...statuses] }
    const docs = (await TreatmentPlanModel()
      .find(where)
      .session(sessionOf(tx) ?? null)
      .lean()) as unknown as PlanRow[]
    return docs.map(toPlan)
  },

  /**
   * Rewrites a plan's content. The precondition is in the filter: a plan the patient answered in
   * the meantime is not quietly changed under them. Returns null when it no longer applies.
   */
  async replaceContent(
    clinicId: string,
    planId: string,
    input: {
      title: string
      phases: string[]
      items: NewPlanItem[]
      totals: PlanTotals
      notes: string | null
    },
  ): Promise<StoredPlan | null> {
    const doc = (await TreatmentPlanModel()
      .findOneAndUpdate(
        { clinicId, _id: planId, status: { $in: ['DRAFT', 'PRESENTED'] } },
        {
          $set: {
            title: input.title,
            phases: input.phases,
            items: itemsFor(input.items),
            openItems: input.items.length,
            ...totalsFor(input.totals),
            notes: input.notes,
            // What the patient saw is no longer what the plan says.
            status: 'DRAFT',
            presentedAt: null,
          },
        },
        { new: true },
      )
      .lean()) as unknown as PlanRow | null
    return doc ? toPlan(doc) : null
  },

  /** Moves a plan from one of `from` to the new state; null if it was no longer in any of them. */
  async transition(
    clinicId: string,
    planId: string,
    from: readonly TreatmentPlanStatus[],
    set: Record<string, unknown> & { status: TreatmentPlanStatus },
  ): Promise<StoredPlan | null> {
    const doc = (await TreatmentPlanModel()
      .findOneAndUpdate(
        { clinicId, _id: planId, status: { $in: [...from] } },
        { $set: set },
        { new: true },
      )
      .lean()) as unknown as PlanRow | null
    return doc ? toPlan(doc) : null
  },

  /** Writes the chart's answer for each item, the open count, and the status that follows. */
  async setProgress(
    clinicId: string,
    planId: string,
    progress: readonly ItemProgress[],
    openItems: number,
    status: TreatmentPlanStatus,
    tx?: Transaction,
  ): Promise<void> {
    if (progress.length === 0) return
    const set: Record<string, unknown> = { openItems, status }
    const arrayFilters: Array<Record<string, unknown>> = []
    progress.forEach((item, index) => {
      const at = `items.$[i${index}]`
      set[`${at}.state`] = item.state
      set[`${at}.doneOn`] = item.doneOn
      set[`${at}.completedByRecordId`] = item.completedByRecordId
      set[`${at}.completedInEncounterId`] = item.completedInEncounterId
      arrayFilters.push({ [`i${index}._id`]: item.itemId })
    })
    await TreatmentPlanModel().updateOne(
      { clinicId, _id: planId },
      { $set: set },
      { arrayFilters, session: sessionOf(tx) },
    )
  },

  /**
   * Marks a done item billed. The preconditions are in the filter, so the same item cannot be put
   * on two invoices by two people pressing the button at once: the second finds nothing to claim.
   */
  async markBilled(
    clinicId: string,
    planId: string,
    itemId: string,
    billed: { invoiceId: string; invoiceNumber: string; at: Date },
    tx?: Transaction,
  ): Promise<boolean> {
    const result = await TreatmentPlanModel().updateOne(
      {
        clinicId,
        _id: planId,
        items: { $elemMatch: { _id: itemId, state: 'DONE', billedInvoiceId: null } },
      },
      {
        $set: {
          'items.$[item].billedInvoiceId': billed.invoiceId,
          'items.$[item].billedInvoiceNumber': billed.invoiceNumber,
          'items.$[item].billedAt': billed.at,
        },
      },
      { arrayFilters: [{ 'item._id': itemId }], session: sessionOf(tx) },
    )
    return result.modifiedCount === 1
  },

  /**
   * Agreed plans with work still open, agreed before `acceptedBefore`, longest-waiting first.
   * `keep` drops rows after they are read (a patient already booked in); the page is filled from
   * further rows so a page of recall is never mostly empty, and the cursor is the last row read.
   */
  async listOverdue(
    clinicId: string,
    acceptedBefore: Date,
    page: { cursor?: string; limit: number },
    keep: (plans: StoredPlan[]) => Promise<StoredPlan[]>,
  ): Promise<Page<StoredPlan>> {
    const kept: StoredPlan[] = []
    let cursor = page.cursor
    // Bounded: at most this many batches are read for one page, whatever `keep` throws away.
    for (let batch = 0; batch < 10; batch += 1) {
      const where: Record<string, unknown> = {
        clinicId,
        status: 'ACCEPTED',
        openItems: { $gt: 0 },
        acceptedAt: { $lte: acceptedBefore },
      }
      if (cursor) {
        where.$and = [keysetAfter(LONGEST_WAITING, decodeCursor(cursor, LONGEST_WAITING.length))]
      }
      const want = page.limit - kept.length
      const docs = (await TreatmentPlanModel()
        .find(where)
        .sort(sortFor(LONGEST_WAITING))
        .limit(want + 1)
        .lean()) as unknown as Array<PlanRow & Record<string, unknown>>
      const { docs: rows, nextCursor } = pageFrom(docs, want, LONGEST_WAITING)
      kept.push(...(await keep(rows.map(toPlan))))
      cursor = nextCursor ?? undefined
      if (!nextCursor || kept.length >= page.limit) {
        return { items: kept.slice(0, page.limit), nextCursor: nextCursor ?? null }
      }
    }
    return { items: kept, nextCursor: cursor ?? null }
  },
}
