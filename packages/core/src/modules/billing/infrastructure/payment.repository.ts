import { PaymentModel, RefundModel, decimal128, newId, nextFormatted } from '@clinic/db'
import type { PaymentMethod, PaymentStatus } from '@clinic/config'
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
import type { Allocation } from '../domain/allocation'

/** Mongoose hands back a Decimal128; money leaves this file as the decimal string it is. */
type Decimalish = { toString(): string } | string | number | null | undefined

const decimal = (value: Decimalish, fallback = '0'): string =>
  value === null || value === undefined ? fallback : String(value)

export interface StoredPayment {
  id: string
  number: string
  clinicId: string
  branchId: string | null
  patientId: string
  patient: { name: string; medicalRecordNo: string }
  amount: string
  refundedAmount: string
  currency: string
  method: PaymentMethod
  status: PaymentStatus
  reference: string | null
  note: string | null
  receivedAt: Date
  receivedBy: PersonRef | null
  allocations: Allocation[]
  pdfFileId: string | null
}

export interface StoredRefund {
  id: string
  paymentId: string
  paymentNumber: string | null
  patientId: string
  amount: string
  currency: string
  reason: string
  allocations: Allocation[]
  refundedAt: Date
  refundedBy: PersonRef | null
}

interface AllocationRecord {
  invoiceId: string
  invoiceNumber?: string | null
  amount?: Decimalish
}

interface PaymentRecord {
  _id: string
  number: string
  clinicId: string
  branchId?: string | null
  patientId: string
  patient?: { name?: string; medicalRecordNo?: string } | null
  amount?: Decimalish
  refundedAmount?: Decimalish
  currency?: string
  method: PaymentMethod
  status?: PaymentStatus
  reference?: string | null
  note?: string | null
  receivedAt?: Date | null
  receivedBy?: PersonRef | null
  allocations?: AllocationRecord[]
  pdfFileId?: string | null
}

interface RefundRecord {
  _id: string
  paymentId: string
  paymentNumber?: string | null
  patientId: string
  amount?: Decimalish
  currency?: string
  reason: string
  allocations?: AllocationRecord[]
  refundedAt?: Date | null
  refundedBy?: PersonRef | null
}

const toAllocation = (allocation: AllocationRecord): Allocation => ({
  invoiceId: allocation.invoiceId,
  invoiceNumber: allocation.invoiceNumber ?? null,
  amount: decimal(allocation.amount),
})

const toPayment = (doc: PaymentRecord): StoredPayment => ({
  id: doc._id,
  number: doc.number,
  clinicId: doc.clinicId,
  branchId: doc.branchId ?? null,
  patientId: doc.patientId,
  patient: {
    name: doc.patient?.name ?? '',
    medicalRecordNo: doc.patient?.medicalRecordNo ?? '',
  },
  amount: decimal(doc.amount),
  refundedAmount: decimal(doc.refundedAmount),
  currency: doc.currency ?? 'USD',
  method: doc.method,
  status: doc.status ?? 'COMPLETED',
  reference: doc.reference ?? null,
  note: doc.note ?? null,
  receivedAt: doc.receivedAt ?? new Date(0),
  receivedBy: doc.receivedBy ?? null,
  allocations: (doc.allocations ?? []).map(toAllocation),
  pdfFileId: doc.pdfFileId ?? null,
})

const toRefund = (doc: RefundRecord): StoredRefund => ({
  id: doc._id,
  paymentId: doc.paymentId,
  paymentNumber: doc.paymentNumber ?? null,
  patientId: doc.patientId,
  amount: decimal(doc.amount),
  currency: doc.currency ?? 'USD',
  reason: doc.reason,
  allocations: (doc.allocations ?? []).map(toAllocation),
  refundedAt: doc.refundedAt ?? new Date(0),
  refundedBy: doc.refundedBy ?? null,
})

/** A MongoDB duplicate-key error, whatever wrapper it arrives in. */
const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000

export interface PaymentFilter {
  patientId?: string
  invoiceId?: string
  method?: PaymentMethod
  from?: Date
  to?: Date
}

function filterFor(clinicId: string, filter: PaymentFilter): Record<string, unknown> {
  const query: Record<string, unknown> = { clinicId }
  if (filter.patientId) query.patientId = filter.patientId
  if (filter.invoiceId) query['allocations.invoiceId'] = filter.invoiceId
  if (filter.method) query.method = filter.method
  if (filter.from || filter.to) {
    const range: Record<string, Date> = {}
    if (filter.from) range.$gte = filter.from
    if (filter.to) range.$lt = filter.to
    query.receivedAt = range
  }
  return query
}

/** `receivedAt` defaults to the moment of recording, so every payment has one. */
const PAYMENT_ORDER: readonly SortKey[] = [
  { field: 'receivedAt', direction: -1, kind: 'date' },
  { field: '_id', direction: -1, kind: 'string' },
]

export const paymentRepository = {
  nextNumber(clinicId: string, year: number): Promise<string> {
    return nextFormatted(`payment:${clinicId}:${year}`, `PAY-${year}`, 6)
  },

  /**
   * The insert that must happen exactly once (ADR-0028).
   *
   * Null means the idempotency key was already used — the unique index refused the second row.
   * The caller does not retry: it reads the payment that already exists and hands that back, so
   * a double-clicked button produces one payment and two identical responses.
   */
  async create(
    input: {
      clinicId: string
      number: string
      branchId: string | null
      patientId: string
      patient: { name: string; medicalRecordNo: string }
      amount: string
      currency: string
      method: PaymentMethod
      reference: string | null
      note: string | null
      receivedAt: Date
      receivedBy: PersonRef
      allocations: Allocation[]
      idempotencyKey: string
    },
    tx: Transaction,
  ): Promise<StoredPayment | null> {
    try {
      const [doc] = await PaymentModel().create(
        [{ _id: newId(), status: 'COMPLETED', refundedAmount: '0', ...input }],
        { session: sessionOf(tx) },
      )
      if (!doc) return null
      return toPayment(doc.toObject() as PaymentRecord)
    } catch (error) {
      if (isDuplicateKey(error)) return null
      throw error
    }
  },

  async findByIdempotencyKey(clinicId: string, key: string): Promise<StoredPayment | null> {
    const doc = (await PaymentModel()
      .findOne({ clinicId, idempotencyKey: key })
      .setOptions({ skipAudit: true })
      .lean()) as PaymentRecord | null
    return doc ? toPayment(doc) : null
  },

  async findById(clinicId: string, paymentId: string): Promise<StoredPayment | null> {
    const doc = (await PaymentModel()
      .findOne({ clinicId, _id: paymentId })
      .lean()) as PaymentRecord | null
    return doc ? toPayment(doc) : null
  },

  /** The permission check's input; not audited, so a refusal is not recorded as a view. */
  async findAccessFacts(
    clinicId: string,
    paymentId: string,
  ): Promise<{
    id: string
    patientId: string
    number: string
    currency: string
    amount: string
    refundedAmount: string
    status: PaymentStatus
    allocations: Allocation[]
    pdfFileId: string | null
  } | null> {
    const doc = (await PaymentModel()
      .findOne({ clinicId, _id: paymentId })
      .select({
        patientId: 1,
        number: 1,
        currency: 1,
        amount: 1,
        refundedAmount: 1,
        status: 1,
        allocations: 1,
        pdfFileId: 1,
      })
      .setOptions({ skipAudit: true })
      .lean()) as PaymentRecord | null
    if (!doc) return null
    return {
      id: doc._id,
      patientId: doc.patientId,
      number: doc.number,
      currency: doc.currency ?? 'USD',
      amount: decimal(doc.amount),
      refundedAmount: decimal(doc.refundedAmount),
      status: doc.status ?? 'COMPLETED',
      allocations: (doc.allocations ?? []).map(toAllocation),
      pdfFileId: doc.pdfFileId ?? null,
    }
  },

  /** A page of payments, most recently received first. Before Phase 10: at most 200, silently. */
  async list(
    clinicId: string,
    filter: PaymentFilter,
    page: { cursor?: string; limit: number },
  ): Promise<Page<StoredPayment>> {
    const where = filterFor(clinicId, filter)
    if (page.cursor) {
      where.$and = [keysetAfter(PAYMENT_ORDER, decodeCursor(page.cursor, PAYMENT_ORDER.length))]
    }
    const docs = (await PaymentModel()
      .find(where)
      .sort(sortFor(PAYMENT_ORDER))
      .limit(page.limit + 1)
      .lean()) as unknown as Array<PaymentRecord & Record<string, unknown>>
    const { docs: rows, nextCursor } = pageFrom(docs, page.limit, PAYMENT_ORDER)
    return { items: rows.map(toPayment), nextCursor }
  },

  /**
   * Move the refunded total on a payment, conditionally: the filter refuses to give back more
   * than was taken, so two simultaneous refunds cannot together exceed the payment. The status
   * is derived inside the pipeline from the payment's own amounts, never from a prior read.
   */
  async applyRefund(
    clinicId: string,
    paymentId: string,
    amount: string,
    tx: Transaction,
  ): Promise<boolean> {
    const value = decimal128(amount)
    const result = await PaymentModel().updateOne(
      {
        clinicId,
        _id: paymentId,
        $expr: { $lte: [{ $add: ['$refundedAmount', value] }, '$amount'] },
      },
      [
        {
          $set: {
            refundedAmount: { $add: ['$refundedAmount', value] },
            status: {
              $cond: [
                { $gte: [{ $add: ['$refundedAmount', value] }, '$amount'] },
                'REFUNDED',
                'PARTIALLY_REFUNDED',
              ],
            },
          },
        },
      ],
      { session: sessionOf(tx) },
    )
    return result.matchedCount > 0
  },

  async recordRefund(
    input: {
      clinicId: string
      paymentId: string
      paymentNumber: string | null
      patientId: string
      amount: string
      currency: string
      reason: string
      allocations: Allocation[]
      refundedAt: Date
      refundedBy: PersonRef
    },
    tx: Transaction,
  ): Promise<StoredRefund> {
    const [doc] = await RefundModel().create([{ _id: newId(), ...input }], {
      session: sessionOf(tx),
    })
    if (!doc) throw new Error('Failed to write the refund')
    return toRefund(doc.toObject() as RefundRecord)
  },

  async listRefunds(
    clinicId: string,
    filter: { paymentId?: string; patientId?: string; from?: Date; to?: Date },
  ): Promise<StoredRefund[]> {
    const query: Record<string, unknown> = { clinicId }
    if (filter.paymentId) query.paymentId = filter.paymentId
    if (filter.patientId) query.patientId = filter.patientId
    if (filter.from || filter.to) {
      const range: Record<string, Date> = {}
      if (filter.from) range.$gte = filter.from
      if (filter.to) range.$lt = filter.to
      query.refundedAt = range
    }
    const docs = (await RefundModel().find(query).sort({ refundedAt: -1 }).lean()) as RefundRecord[]
    return docs.map(toRefund)
  },

  /** Claim the receipt's PDF slot; the loser of a race serves the winner's file. */
  async attachPdf(clinicId: string, paymentId: string, fileId: string): Promise<string> {
    const won = (await PaymentModel()
      .findOneAndUpdate(
        { clinicId, _id: paymentId, pdfFileId: null },
        { $set: { pdfFileId: fileId } },
        { new: true },
      )
      .select({ pdfFileId: 1 })
      .setOptions({ skipAudit: true })
      .lean()) as { pdfFileId?: string | null } | null
    if (won?.pdfFileId) return won.pdfFileId

    const current = (await PaymentModel()
      .findOne({ clinicId, _id: paymentId })
      .select({ pdfFileId: 1 })
      .setOptions({ skipAudit: true })
      .lean()) as { pdfFileId?: string | null } | null
    return current?.pdfFileId ?? fileId
  },

  /**
   * What was taken on a day, split by how it was taken. The daily report's left-hand column;
   * the refunds ledger supplies the right-hand one.
   */
  async takingsByMethod(
    clinicId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ method: PaymentMethod; taken: string; count: number }>> {
    const rows = (await PaymentModel().aggregate([
      { $match: { clinicId, receivedAt: { $gte: from, $lt: to } } },
      { $group: { _id: '$method', taken: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ])) as Array<{ _id: PaymentMethod; taken: Decimalish; count: number }>
    return rows.map((row) => ({ method: row._id, taken: decimal(row.taken), count: row.count }))
  },

  /**
   * What went back out on a day, by the method of the payment it came off — a card refund is
   * not cash out of the drawer, and a report that mixed them would not reconcile.
   */
  async refundsByMethod(
    clinicId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ method: PaymentMethod; refunded: string }>> {
    const rows = (await RefundModel().aggregate([
      { $match: { clinicId, refundedAt: { $gte: from, $lt: to } } },
      {
        $lookup: {
          from: 'payments',
          localField: 'paymentId',
          foreignField: '_id',
          as: 'payment',
        },
      },
      { $unwind: '$payment' },
      { $group: { _id: '$payment.method', refunded: { $sum: '$amount' } } },
      { $sort: { _id: 1 } },
    ])) as Array<{ _id: PaymentMethod; refunded: Decimalish }>
    return rows.map((row) => ({ method: row._id, refunded: decimal(row.refunded) }))
  },
}
