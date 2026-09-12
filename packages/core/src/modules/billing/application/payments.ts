import {
  compareAmounts,
  isZeroAmount,
  localDateIn,
  normalizeAmount,
  subtractAmounts,
} from '@clinic/contracts'
import type {
  Payment,
  PaymentListQuery,
  RecordPaymentRequest,
  RefundPaymentRequest,
} from '@clinic/contracts'
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../errors'
import { runInTransaction } from '../../../transaction'
import { recordAudit } from '../../audit'
import { emitEvent } from '../../outbox'
import { assertCan, careRelationship, type Actor } from '../../access'
import { getClinicFacts } from '../../clinic'
import { findPatientForScheduling } from '../../patients'
import { instantOf, nextDate } from '../../scheduling'

import { allocationsBalance, unwindAllocations } from '../domain/allocation'
import { invoiceRepository } from '../infrastructure/invoice.repository'
import {
  paymentRepository,
  type PaymentFilter,
  type StoredPayment,
} from '../infrastructure/payment.repository'
import { billingResource } from './scope'

export function toPayment(payment: StoredPayment): Payment {
  return {
    id: payment.id,
    number: payment.number,
    status: payment.status,
    patient: {
      id: payment.patientId,
      name: payment.patient.name,
      medicalRecordNo: payment.patient.medicalRecordNo,
    },
    amount: payment.amount,
    refundedAmount: payment.refundedAmount,
    currency: payment.currency,
    method: payment.method,
    reference: payment.reference,
    note: payment.note,
    receivedAt: payment.receivedAt.toISOString(),
    receivedBy: payment.receivedBy,
    allocations: payment.allocations,
    pdfFileId: payment.pdfFileId,
  }
}

/** Thrown inside the transaction when the idempotency key has already been used. */
class AlreadyRecorded extends Error {}

/**
 * Taking money (S8) — the one genuinely multi-document write in the system, and the one the
 * phase's exit criterion is about: **a double-clicked payment creates one row.**
 *
 * Three things make that true, and all three are needed:
 *
 *  1. the idempotency key has a unique index, so the second insert loses at the database rather
 *     than on a prior read (ADR-0028);
 *  2. the insert and every invoice it settles happen in one transaction, so a crash between them
 *     cannot leave money recorded against a balance that never moved;
 *  3. each invoice's balance moves by a conditional pipeline update, so the new status is
 *     computed server-side from the document's own values and never from a stale read.
 *
 * The fast path below — looking the key up first — is a courtesy, not the guard. It answers the
 * common double-click, where the second request arrives after the first has committed, without
 * opening a transaction at all. The guard is the index.
 */
export async function recordPayment(
  actor: Actor,
  input: RecordPaymentRequest,
  now: Date = new Date(),
): Promise<Payment> {
  await assertCan(
    actor,
    'payment:record',
    billingResource(actor, 'Payment', { id: null, patientId: input.patientId }),
  )

  const seen = await paymentRepository.findByIdempotencyKey(actor.clinicId, input.idempotencyKey)
  if (seen) return toPayment(seen)

  const [clinic, patient] = await Promise.all([
    getClinicFacts(actor.clinicId),
    findPatientForScheduling(actor.clinicId, input.patientId),
  ])
  if (!patient) throw new NotFoundError('Patient')

  const amount = normalizeAmount(input.amount, clinic.currency)
  if (amount === null || isZeroAmount(amount)) {
    throw new ValidationError('That is not an amount this clinic can take.', [
      { field: 'amount', issue: 'INVALID_AMOUNT' },
    ])
  }

  const allocations = input.allocations.map((allocation, index) => {
    const value = normalizeAmount(allocation.amount, clinic.currency)
    if (value === null || isZeroAmount(value)) {
      throw new ValidationError('That is not an amount this clinic can take.', [
        { field: `allocations.${index}.amount`, issue: 'INVALID_AMOUNT' },
      ])
    }
    return { invoiceId: allocation.invoiceId, amount: value }
  })

  if (!allocationsBalance(amount, allocations, clinic.currency)) {
    throw new ValidationError('The payment must be fully allocated to invoices.', [
      { field: 'allocations', issue: 'DOES_NOT_BALANCE' },
    ])
  }

  // Every invoice is checked before anything is written, so the common mistakes — a bill for
  // somebody else, one already paid, one asked to take more than it owes — come back as a
  // message rather than as a half-applied payment the transaction then rolls back.
  const named: Array<{ invoiceId: string; invoiceNumber: string | null; amount: string }> = []
  for (const allocation of allocations) {
    const invoice = await invoiceRepository.findAccessFacts(actor.clinicId, allocation.invoiceId)
    if (!invoice) throw new NotFoundError('Invoice')
    if (invoice.patientId !== patient.id) {
      throw new BusinessRuleError(
        'INVOICE_PATIENT_MISMATCH',
        `Invoice ${invoice.number} belongs to a different patient.`,
      )
    }
    if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') {
      throw new BusinessRuleError(
        'INVOICE_NOT_PAYABLE',
        `Invoice ${invoice.number} cannot take a payment — it is ${invoice.status.toLowerCase().replace('_', ' ')}.`,
      )
    }
    if (compareAmounts(allocation.amount, invoice.balanceDue) > 0) {
      throw new BusinessRuleError(
        'OVERPAYMENT',
        `Invoice ${invoice.number} only owes ${invoice.balanceDue} ${invoice.currency}.`,
      )
    }
    named.push({ ...allocation, invoiceNumber: invoice.number })
  }

  const year = Number(localDateIn(clinic.timezone, now).slice(0, 4))
  const number = await paymentRepository.nextNumber(actor.clinicId, year)

  let payment: StoredPayment
  try {
    payment = await runInTransaction(async (tx) => {
      const created = await paymentRepository.create(
        {
          clinicId: actor.clinicId,
          number,
          branchId: null,
          patientId: patient.id,
          patient: { name: patient.name, medicalRecordNo: patient.medicalRecordNo },
          amount,
          currency: clinic.currency,
          method: input.method,
          reference: input.reference,
          note: input.note,
          receivedAt: now,
          receivedBy: { id: actor.userId, name: actor.displayName },
          allocations: named,
          idempotencyKey: input.idempotencyKey,
        },
        tx,
      )
      // The key was used by a request still in flight. Unwind and serve theirs.
      if (!created) throw new AlreadyRecorded()

      for (const allocation of named) {
        const applied = await invoiceRepository.applyPayment(
          actor.clinicId,
          allocation.invoiceId,
          allocation.amount,
          tx,
        )
        if (!applied) {
          throw new ConflictError(
            'INVOICE_CHANGED',
            `Invoice ${allocation.invoiceNumber} changed while the payment was being taken.`,
          )
        }
      }

      // Inside the transaction that took the money, so a receipt can never be sent for a
      // payment that rolled back (13.4).
      await emitEvent(actor.clinicId, 'payment.recorded', { paymentId: created.id }, tx, now)

      return created
    })
  } catch (error) {
    if (!(error instanceof AlreadyRecorded)) throw error
    const existing = await paymentRepository.findByIdempotencyKey(
      actor.clinicId,
      input.idempotencyKey,
    )
    if (!existing) throw new ConflictError('PAYMENT_IN_FLIGHT', 'That payment is being recorded.')
    return toPayment(existing)
  }

  await recordAudit({
    action: 'payment.recorded',
    category: 'FINANCIAL',
    severity: 'NOTICE',
    clinicId: actor.clinicId,
    entity: { type: 'Payment', id: payment.id },
    metadata: {
      number: payment.number,
      patientId: payment.patientId,
      amount: payment.amount,
      currency: payment.currency,
      method: payment.method,
      invoices: named.map((allocation) => allocation.invoiceNumber),
    },
  })

  return toPayment(payment)
}

/**
 * Giving money back (S8). The mirror of taking it, and transactional for the same reason: the
 * refund, the payment's refunded total and every invoice balance it reverses have to move
 * together or not at all.
 *
 * Which invoices it comes off is decided in the domain — the last one settled gives it back
 * first — so the split is deterministic and testable rather than a rule buried in a query.
 */
export async function refundPayment(
  actor: Actor,
  paymentId: string,
  input: RefundPaymentRequest,
  now: Date = new Date(),
): Promise<Payment> {
  const facts = await paymentRepository.findAccessFacts(actor.clinicId, paymentId)
  if (!facts) throw new NotFoundError('Payment')
  await assertCan(actor, 'payment:refund', billingResource(actor, 'Payment', facts))

  const clinic = await getClinicFacts(actor.clinicId)
  const amount = normalizeAmount(input.amount, clinic.currency)
  if (amount === null || isZeroAmount(amount)) {
    throw new ValidationError('That is not an amount this clinic can refund.', [
      { field: 'amount', issue: 'INVALID_AMOUNT' },
    ])
  }

  const refundable = subtractAmounts(clinic.currency, facts.amount, facts.refundedAmount)
  if (compareAmounts(amount, refundable) > 0) {
    throw new BusinessRuleError(
      'REFUND_EXCEEDS_PAYMENT',
      `Only ${refundable} ${facts.currency} of this payment can still be refunded.`,
    )
  }

  const unwound = unwindAllocations(
    facts.allocations,
    facts.refundedAmount,
    amount,
    clinic.currency,
  )

  await runInTransaction(async (tx) => {
    const applied = await paymentRepository.applyRefund(actor.clinicId, paymentId, amount, tx)
    if (!applied) {
      throw new ConflictError('PAYMENT_CHANGED', 'That payment was refunded a moment ago.')
    }

    for (const allocation of unwound) {
      const reversed = await invoiceRepository.reversePayment(
        actor.clinicId,
        allocation.invoiceId,
        allocation.amount,
        tx,
      )
      if (!reversed) {
        throw new ConflictError(
          'INVOICE_CHANGED',
          `Invoice ${allocation.invoiceNumber} changed while the refund was being made.`,
        )
      }
    }

    await paymentRepository.recordRefund(
      {
        clinicId: actor.clinicId,
        paymentId,
        paymentNumber: facts.number,
        patientId: facts.patientId,
        amount,
        currency: clinic.currency,
        reason: input.reason,
        allocations: unwound,
        refundedAt: now,
        refundedBy: { id: actor.userId, name: actor.displayName },
      },
      tx,
    )
  })

  await recordAudit({
    action: 'payment.refunded',
    category: 'FINANCIAL',
    severity: 'WARNING',
    clinicId: actor.clinicId,
    entity: { type: 'Payment', id: paymentId },
    metadata: {
      number: facts.number,
      patientId: facts.patientId,
      amount,
      currency: clinic.currency,
      reason: input.reason,
      invoices: unwound.map((allocation) => allocation.invoiceNumber),
    },
  })

  const payment = await paymentRepository.findById(actor.clinicId, paymentId)
  if (!payment) throw new NotFoundError('Payment')
  return toPayment(payment)
}

export async function listPayments(actor: Actor, query: PaymentListQuery): Promise<Payment[]> {
  const clinic = await getClinicFacts(actor.clinicId)
  const filter = await paymentFilterFor(actor, query, clinic.timezone)
  const payments = await paymentRepository.list(actor.clinicId, filter)
  return payments.map(toPayment)
}

export async function getPayment(actor: Actor, paymentId: string): Promise<Payment> {
  const facts = await paymentRepository.findAccessFacts(actor.clinicId, paymentId)
  if (!facts) throw new NotFoundError('Payment')
  await assertCan(actor, 'payment:read', billingResource(actor, 'Payment', facts))

  const payment = await paymentRepository.findById(actor.clinicId, paymentId)
  if (!payment) throw new NotFoundError('Payment')
  return toPayment(payment)
}

/** The same narrowing the invoice list does, over payments (section 7.3). */
export async function paymentFilterFor(
  actor: Actor,
  query: PaymentListQuery,
  timezone: string,
): Promise<PaymentFilter> {
  await assertCan(actor, 'payment:read')
  const scope = actor.permissions.get('payment:read')

  const filter: PaymentFilter = { invoiceId: query.invoiceId, method: query.method }
  if (query.from) filter.from = instantOf(query.from, '00:00', timezone)
  if (query.to) filter.to = instantOf(nextDate(query.to), '00:00', timezone)

  if (scope === 'OWN') {
    if (!actor.patientId) throw new ForbiddenError('payment:read')
    filter.patientId = actor.patientId
    return filter
  }
  if (scope === 'ASSIGNED') {
    if (!actor.doctorId || !query.patientId) throw new ForbiddenError('payment:read')
    const treats = await careRelationship().hasTreated(
      actor.clinicId,
      actor.doctorId,
      query.patientId,
    )
    if (!treats) throw new ForbiddenError('payment:read')
    filter.patientId = query.patientId
    return filter
  }
  if (scope === 'CLINIC' || scope === 'GLOBAL') {
    filter.patientId = query.patientId
    return filter
  }
  throw new ForbiddenError('payment:read')
}
