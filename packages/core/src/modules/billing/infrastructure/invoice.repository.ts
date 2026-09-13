import { InvoiceModel, decimal128, newId, nextFormatted } from '@clinic/db'
import { addAmounts } from '@clinic/contracts'
import type { InvoiceStatus } from '@clinic/config'
import type { PersonRef } from '@clinic/contracts'
import { sessionOf, type Transaction } from '../../../transaction'
import {
  decodeCursor,
  keysetAfter,
  pageFrom,
  sortFor,
  type Page,
  type SortKey,
} from '../../../pagination'
import type { ComputedLine, ComputedTotals } from '../domain/totals'

/** Mongoose hands back a Decimal128; an invoice speaks in the decimal strings it was written in. */
type Decimalish = { toString(): string } | string | number | null | undefined

const decimal = (value: Decimalish, fallback = '0'): string =>
  value === null || value === undefined ? fallback : String(value)

export interface StoredInvoiceLine extends ComputedLine {
  id: string
}

export interface StoredInvoice {
  id: string
  number: string
  clinicId: string
  branchId: string | null
  patientId: string
  patient: { name: string; medicalRecordNo: string }
  encounterId: string | null
  status: InvoiceStatus
  issuedAt: Date | null
  dueAt: string | null
  lines: StoredInvoiceLine[]
  currency: string
  subtotal: string
  discountTotal: string
  taxTotal: string
  total: string
  amountPaid: string
  balanceDue: string
  notes: string | null
  pdfFileId: string | null
  voidedAt: Date | null
  voidReason: string | null
  createdAt: Date | null
  createdBy: PersonRef | null
}

/** Just enough to answer "may this actor touch it, and what state is it in". */
export interface InvoiceAccessFacts {
  id: string
  patientId: string
  encounterId: string | null
  status: InvoiceStatus
  currency: string
  number: string
  total: string
  balanceDue: string
  pdfFileId: string | null
}

interface LineRecord {
  _id: string
  serviceId?: string | null
  inventoryItemId?: string | null
  description: string
  quantity?: Decimalish
  unitPrice?: Decimalish
  discount?: Decimalish
  taxRatePercent?: Decimalish
  gross?: Decimalish
  net?: Decimalish
  tax?: Decimalish
  lineTotal?: Decimalish
}

interface InvoiceRecord {
  _id: string
  number: string
  clinicId: string
  branchId?: string | null
  patientId: string
  patient?: { name?: string; medicalRecordNo?: string } | null
  encounterId?: string | null
  status?: InvoiceStatus
  issuedAt?: Date | null
  dueAt?: string | null
  lines?: LineRecord[]
  currency?: string
  subtotal?: Decimalish
  discountTotal?: Decimalish
  taxTotal?: Decimalish
  total?: Decimalish
  amountPaid?: Decimalish
  balanceDue?: Decimalish
  notes?: string | null
  pdfFileId?: string | null
  voidedAt?: Date | null
  voidReason?: string | null
  createdAt?: Date | null
  createdBy?: PersonRef | null
}

const toLine = (line: LineRecord): StoredInvoiceLine => ({
  id: line._id,
  serviceId: line.serviceId ?? null,
  inventoryItemId: line.inventoryItemId ?? null,
  description: line.description,
  quantity: decimal(line.quantity),
  unitPrice: decimal(line.unitPrice),
  discount: decimal(line.discount),
  taxRatePercent: decimal(line.taxRatePercent),
  gross: decimal(line.gross),
  net: decimal(line.net),
  tax: decimal(line.tax),
  lineTotal: decimal(line.lineTotal),
})

const toInvoice = (doc: InvoiceRecord): StoredInvoice => ({
  id: doc._id,
  number: doc.number,
  clinicId: doc.clinicId,
  branchId: doc.branchId ?? null,
  patientId: doc.patientId,
  patient: {
    name: doc.patient?.name ?? '',
    medicalRecordNo: doc.patient?.medicalRecordNo ?? '',
  },
  encounterId: doc.encounterId ?? null,
  status: doc.status ?? 'DRAFT',
  issuedAt: doc.issuedAt ?? null,
  dueAt: doc.dueAt ?? null,
  lines: (doc.lines ?? []).map(toLine),
  currency: doc.currency ?? 'USD',
  subtotal: decimal(doc.subtotal),
  discountTotal: decimal(doc.discountTotal),
  taxTotal: decimal(doc.taxTotal),
  total: decimal(doc.total),
  amountPaid: decimal(doc.amountPaid),
  balanceDue: decimal(doc.balanceDue),
  notes: doc.notes ?? null,
  pdfFileId: doc.pdfFileId ?? null,
  voidedAt: doc.voidedAt ?? null,
  voidReason: doc.voidReason ?? null,
  createdAt: doc.createdAt ?? null,
  createdBy: doc.createdBy ?? null,
})

const linesFor = (lines: ComputedLine[]) => lines.map((line) => ({ _id: newId(), ...line }))

export interface InvoiceFilter {
  patientId?: string
  encounterId?: string
  status?: InvoiceStatus
  outstanding?: boolean
  /** Both are calendar dates, matched against the invoice's issue date in the clinic's zone. */
  issuedFrom?: Date
  issuedTo?: Date
}

function filterFor(clinicId: string, filter: InvoiceFilter): Record<string, unknown> {
  const query: Record<string, unknown> = { clinicId }
  if (filter.patientId) query.patientId = filter.patientId
  if (filter.encounterId) query.encounterId = filter.encounterId
  if (filter.status) query.status = filter.status
  if (filter.outstanding) {
    query.balanceDue = { $gt: decimal128('0') }
    query.status = filter.status ?? { $in: ['ISSUED', 'PARTIALLY_PAID'] }
  }
  if (filter.issuedFrom || filter.issuedTo) {
    const range: Record<string, Date> = {}
    if (filter.issuedFrom) range.$gte = filter.issuedFrom
    if (filter.issuedTo) range.$lt = filter.issuedTo
    query.issuedAt = range
  }
  return query
}

/** Newest first; `createdAt` comes from the schema's timestamps, so it is never null. */
const INVOICE_ORDER: readonly SortKey[] = [
  { field: 'createdAt', direction: -1, kind: 'date' },
  { field: '_id', direction: -1, kind: 'string' },
]

export const invoiceRepository = {
  /**
   * "INV-2026-000318". The sequence restarts each calendar year, which is what an accountant
   * expects of an invoice book, and the year in the number makes a stray document self-locating.
   */
  nextNumber(clinicId: string, year: number): Promise<string> {
    return nextFormatted(`invoice:${clinicId}:${year}`, `INV-${year}`, 6)
  },

  async create(
    input: {
      clinicId: string
      number: string
      branchId: string | null
      patientId: string
      patient: { name: string; medicalRecordNo: string }
      encounterId: string | null
      currency: string
      totals: ComputedTotals
      notes: string | null
      createdBy: PersonRef
    },
    tx?: Transaction,
  ): Promise<StoredInvoice> {
    const [doc] = await InvoiceModel().create(
      [
        {
          _id: newId(),
          clinicId: input.clinicId,
          number: input.number,
          branchId: input.branchId,
          patientId: input.patientId,
          patient: input.patient,
          encounterId: input.encounterId,
          status: 'DRAFT',
          lines: linesFor(input.totals.lines),
          currency: input.currency,
          subtotal: input.totals.subtotal,
          discountTotal: input.totals.discountTotal,
          taxTotal: input.totals.taxTotal,
          total: input.totals.total,
          amountPaid: '0',
          balanceDue: input.totals.total,
          notes: input.notes,
          createdBy: input.createdBy,
        },
      ],
      { session: sessionOf(tx) },
    )
    if (!doc) throw new Error('Failed to write the invoice')
    return toInvoice(doc.toObject() as InvoiceRecord)
  },

  async findById(clinicId: string, invoiceId: string): Promise<StoredInvoice | null> {
    const doc = (await InvoiceModel()
      .findOne({ clinicId, _id: invoiceId })
      .lean()) as InvoiceRecord | null
    return doc ? toInvoice(doc) : null
  },

  /**
   * The permission check's input, read without the lines and without auditing: deciding whether
   * somebody may look must not itself appear as a view, or a refused attempt would show up in
   * the record as one (section 11.3).
   */
  async findAccessFacts(clinicId: string, invoiceId: string): Promise<InvoiceAccessFacts | null> {
    const doc = (await InvoiceModel()
      .findOne({ clinicId, _id: invoiceId })
      .select({
        patientId: 1,
        encounterId: 1,
        status: 1,
        currency: 1,
        number: 1,
        total: 1,
        balanceDue: 1,
        pdfFileId: 1,
      })
      .setOptions({ skipAudit: true })
      .lean()) as InvoiceRecord | null
    if (!doc) return null
    return {
      id: doc._id,
      patientId: doc.patientId,
      encounterId: doc.encounterId ?? null,
      status: doc.status ?? 'DRAFT',
      currency: doc.currency ?? 'USD',
      number: doc.number,
      total: decimal(doc.total),
      balanceDue: decimal(doc.balanceDue),
      pdfFileId: doc.pdfFileId ?? null,
    }
  },

  /** A page of invoices, newest first. Before Phase 10: at most 200, and nothing said. */
  async list(
    clinicId: string,
    filter: InvoiceFilter,
    page: { cursor?: string; limit: number },
  ): Promise<Page<StoredInvoice>> {
    const where = filterFor(clinicId, filter)
    if (page.cursor) {
      where.$and = [keysetAfter(INVOICE_ORDER, decodeCursor(page.cursor, INVOICE_ORDER.length))]
    }
    const docs = (await InvoiceModel()
      .find(where)
      .sort(sortFor(INVOICE_ORDER))
      .limit(page.limit + 1)
      .lean()) as unknown as Array<InvoiceRecord & Record<string, unknown>>
    const { docs: rows, nextCursor } = pageFrom(docs, page.limit, INVOICE_ORDER)
    return { items: rows.map(toInvoice), nextCursor }
  },

  /**
   * Editing a draft. The precondition is in the filter, never in a prior read: an invoice
   * issued between the check and the write matches nothing and the caller is told so.
   */
  async updateDraft(
    clinicId: string,
    invoiceId: string,
    changes: { totals?: ComputedTotals; notes?: string | null },
  ): Promise<StoredInvoice | null> {
    const set: Record<string, unknown> = {}
    if (changes.totals) {
      set.lines = linesFor(changes.totals.lines)
      set.subtotal = changes.totals.subtotal
      set.discountTotal = changes.totals.discountTotal
      set.taxTotal = changes.totals.taxTotal
      set.total = changes.totals.total
      // A draft has taken no money, so the balance is simply what it now totals.
      set.balanceDue = changes.totals.total
    }
    if (changes.notes !== undefined) set.notes = changes.notes

    const doc = (await InvoiceModel()
      .findOneAndUpdate({ clinicId, _id: invoiceId, status: 'DRAFT' }, { $set: set }, { new: true })
      .lean()) as InvoiceRecord | null
    return doc ? toInvoice(doc) : null
  },

  /**
   * Adding lines to a draft that is already there — what consuming stock during a visit does.
   *
   * This is a $push and an $inc rather than a read, a recompute and a write, and it is correct
   * for a reason worth naming: **because each line rounds once and the invoice is defined as the
   * sum of rounded lines (ADR-0027), appending a line changes every total by exactly that line's
   * own figures.** Nothing has to be recomputed from the others, so two people adding lines at
   * once both land, and neither overwrites the other's.
   */
  async appendLines(
    clinicId: string,
    invoiceId: string,
    lines: ComputedLine[],
    currency: string,
    tx?: Transaction,
  ): Promise<StoredInvoice | null> {
    if (lines.length === 0) return this.findById(clinicId, invoiceId)

    const sum = (pick: (line: ComputedLine) => string) =>
      decimal128(addAmounts(currency, ...lines.map(pick)))

    const doc = (await InvoiceModel()
      .findOneAndUpdate(
        { clinicId, _id: invoiceId, status: 'DRAFT' },
        {
          $push: { lines: { $each: linesFor(lines) } },
          $inc: {
            subtotal: sum((line) => line.gross),
            discountTotal: sum((line) => line.discount),
            taxTotal: sum((line) => line.tax),
            total: sum((line) => line.lineTotal),
            // A draft has taken no money, so the balance moves with the total.
            balanceDue: sum((line) => line.lineTotal),
          },
        },
        { new: true, session: sessionOf(tx) },
      )
      .lean()) as InvoiceRecord | null
    return doc ? toInvoice(doc) : null
  },

  async issue(
    clinicId: string,
    invoiceId: string,
    issuedAt: Date,
    dueAt: string | null,
  ): Promise<StoredInvoice | null> {
    const doc = (await InvoiceModel()
      .findOneAndUpdate(
        { clinicId, _id: invoiceId, status: 'DRAFT' },
        { $set: { status: 'ISSUED', issuedAt, dueAt } },
        { new: true },
      )
      .lean()) as InvoiceRecord | null
    return doc ? toInvoice(doc) : null
  },

  async void(
    clinicId: string,
    invoiceId: string,
    reason: string,
    voidedAt: Date,
    voidedBy: PersonRef,
  ): Promise<StoredInvoice | null> {
    const doc = (await InvoiceModel()
      .findOneAndUpdate(
        // Never a paid one: money already taken has to be refunded before the bill can go away.
        { clinicId, _id: invoiceId, status: { $in: ['DRAFT', 'ISSUED'] } },
        { $set: { status: 'VOID', voidedAt, voidReason: reason, voidedBy } },
        { new: true },
      )
      .lean()) as InvoiceRecord | null
    return doc ? toInvoice(doc) : null
  },

  /**
   * Settling part or all of an invoice — the write that must be correct under concurrency
   * (section 8.10).
   *
   * The new status is computed **inside** the pipeline from the document's own current values,
   * so PARTIALLY_PAID -> PAID can never be decided from a stale read. `balanceDue: { $gte }` in
   * the filter is what makes overpayment impossible: an allocation larger than what is owed
   * matches no document at all rather than driving the balance negative.
   */
  async applyPayment(
    clinicId: string,
    invoiceId: string,
    amount: string,
    tx: Transaction,
  ): Promise<boolean> {
    const value = decimal128(amount)
    const result = await InvoiceModel().updateOne(
      {
        clinicId,
        _id: invoiceId,
        status: { $in: ['ISSUED', 'PARTIALLY_PAID'] },
        balanceDue: { $gte: value },
      },
      [
        {
          $set: {
            amountPaid: { $add: ['$amountPaid', value] },
            balanceDue: { $subtract: ['$balanceDue', value] },
            status: {
              $cond: [
                { $lte: [{ $subtract: ['$balanceDue', value] }, 0] },
                'PAID',
                'PARTIALLY_PAID',
              ],
            },
          },
        },
      ],
      { session: sessionOf(tx) },
    )
    return result.matchedCount > 0
  },

  /**
   * Putting money back on an invoice. The mirror of applyPayment, and conditional in the same
   * way: `amountPaid: { $gte }` refuses to give back more than was ever taken.
   */
  async reversePayment(
    clinicId: string,
    invoiceId: string,
    amount: string,
    tx: Transaction,
  ): Promise<boolean> {
    const value = decimal128(amount)
    const result = await InvoiceModel().updateOne(
      {
        clinicId,
        _id: invoiceId,
        status: { $in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] },
        amountPaid: { $gte: value },
      },
      [
        {
          $set: {
            amountPaid: { $subtract: ['$amountPaid', value] },
            balanceDue: { $add: ['$balanceDue', value] },
            status: {
              $cond: [
                { $lte: [{ $subtract: ['$amountPaid', value] }, 0] },
                'ISSUED',
                {
                  $cond: [
                    { $lte: [{ $add: ['$balanceDue', value] }, 0] },
                    'PAID',
                    'PARTIALLY_PAID',
                  ],
                },
              ],
            },
          },
        },
      ],
      { session: sessionOf(tx) },
    )
    return result.matchedCount > 0
  },

  /**
   * Claim the invoice's PDF slot. Two simultaneous downloads each render a copy; only one may
   * be the invoice's, and whichever loses serves the winner's rather than its own, so the
   * document has exactly one printable form.
   */
  async attachPdf(clinicId: string, invoiceId: string, fileId: string): Promise<string> {
    const won = (await InvoiceModel()
      .findOneAndUpdate(
        { clinicId, _id: invoiceId, pdfFileId: null },
        { $set: { pdfFileId: fileId } },
        { new: true },
      )
      .select({ pdfFileId: 1 })
      .setOptions({ skipAudit: true })
      .lean()) as { pdfFileId?: string | null } | null
    if (won?.pdfFileId) return won.pdfFileId

    const current = (await InvoiceModel()
      .findOne({ clinicId, _id: invoiceId })
      .select({ pdfFileId: 1 })
      .setOptions({ skipAudit: true })
      .lean()) as { pdfFileId?: string | null } | null
    return current?.pdfFileId ?? fileId
  },

  /** Totals for a patient's statement, or for the day's invoicing. Never over VOIDed rows. */
  async totals(
    clinicId: string,
    filter: InvoiceFilter,
  ): Promise<{ invoiced: string; paid: string; outstanding: string; count: number }> {
    const match = { ...filterFor(clinicId, filter), status: { $ne: 'VOID' } }
    const [row] = (await InvoiceModel().aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          invoiced: { $sum: '$total' },
          paid: { $sum: '$amountPaid' },
          outstanding: { $sum: '$balanceDue' },
          count: { $sum: 1 },
        },
      },
    ])) as Array<{ invoiced: Decimalish; paid: Decimalish; outstanding: Decimalish; count: number }>

    return {
      invoiced: decimal(row?.invoiced),
      paid: decimal(row?.paid),
      outstanding: decimal(row?.outstanding),
      count: row?.count ?? 0,
    }
  },
}
