import { addAmounts, localDateIn, subtractAmounts, zeroAmount } from '@clinic/contracts'
import type {
  AccountStatement,
  DailyReconciliation,
  DailyReconciliationQuery,
  MethodTotal,
} from '@clinic/contracts'
import { PAYMENT_METHODS } from '@clinic/config'
import { ForbiddenError } from '../../../errors'
import { assertCan, type Actor } from '../../access'
import { getClinicFacts } from '../../clinic'
import { instantOf, nextDate } from '../../scheduling'

import { invoiceRepository } from '../infrastructure/invoice.repository'
import { paymentRepository } from '../infrastructure/payment.repository'
import { invoiceFilterFor, toInvoiceSummary } from './invoicing'
import { paymentFilterFor, toPayment } from './payments'

/**
 * The day's money (S9) — the report a front desk closes on, and the phase's last exit
 * criterion: **it reconciles to the cent.**
 *
 * It does so because every figure on it is a sum of stored decimals rather than a recomputation:
 * `net` is `taken - refunded` for each method, the footer is the sum of those same per-method
 * figures, and nothing is derived twice by two different routes. A report whose total is
 * computed independently of its rows is a report that will one day disagree with them.
 *
 * The day is a calendar day in the clinic's own zone, half-open [00:00, next 00:00), so a
 * payment taken at 23:59 belongs to the day the cashier thinks it does (ADR-0010).
 */
export async function dailyReconciliation(
  actor: Actor,
  query: DailyReconciliationQuery,
): Promise<DailyReconciliation> {
  await assertCan(actor, 'payment:read')
  const scope = actor.permissions.get('payment:read')
  // A patient's own payments are not the clinic's day. This report is the drawer, not a receipt.
  if (scope !== 'CLINIC' && scope !== 'GLOBAL') throw new ForbiddenError('payment:read')

  const clinic = await getClinicFacts(actor.clinicId)
  const from = instantOf(query.date, '00:00', clinic.timezone)
  const to = instantOf(nextDate(query.date), '00:00', clinic.timezone)
  const currency = clinic.currency
  const zero = zeroAmount(currency)

  const [takings, refunds, invoiced] = await Promise.all([
    paymentRepository.takingsByMethod(actor.clinicId, from, to),
    paymentRepository.refundsByMethod(actor.clinicId, from, to),
    invoiceRepository.totals(actor.clinicId, { issuedFrom: from, issuedTo: to }),
  ])

  const takenBy = new Map(takings.map((row) => [row.method, row]))
  const refundedBy = new Map(refunds.map((row) => [row.method, row.refunded]))

  // Every method the clinic accepts appears, including the ones that took nothing: a row of
  // zeroes is information at the end of a day, and a missing row reads as an oversight.
  const byMethod: MethodTotal[] = PAYMENT_METHODS.map((method) => {
    const taken = takenBy.get(method)?.taken ?? zero
    const refunded = refundedBy.get(method) ?? zero
    return {
      method,
      taken,
      refunded,
      net: subtractAmounts(currency, taken, refunded),
      count: takenBy.get(method)?.count ?? 0,
    }
  })

  const taken = addAmounts(currency, ...byMethod.map((row) => row.taken))
  const refunded = addAmounts(currency, ...byMethod.map((row) => row.refunded))

  return {
    date: query.date,
    currency,
    byMethod,
    taken,
    refunded,
    net: subtractAmounts(currency, taken, refunded),
    count: byMethod.reduce((sum, row) => sum + row.count, 0),
    invoiced: invoiced.invoiced,
    invoiceCount: invoiced.count,
  }
}

/** How many of each a statement lists. The totals are computed over all of them regardless. */
const STATEMENT_LINES = 100

/**
 * A patient's statement of account (P8): everything they have been billed and everything they
 * have paid, with the difference stated once.
 *
 * The permission narrowing is the list's own — a patient reaches their own statement, a clinic
 * reaches anybody's — so there is no second, subtly different rule to keep in step.
 */
export async function accountStatement(
  actor: Actor,
  patientId: string | undefined,
  now: Date = new Date(),
): Promise<AccountStatement> {
  const clinic = await getClinicFacts(actor.clinicId)
  const [invoiceFilter, paymentFilter] = await Promise.all([
    invoiceFilterFor(actor, { patientId }, clinic.timezone),
    paymentFilterFor(actor, { patientId }, clinic.timezone),
  ])

  // The list keeps voided invoices — a patient should see that a bill was cancelled rather than
  // find it missing — while the totals exclude them, because a void owes nothing.
  const [invoices, payments, totals] = await Promise.all([
    invoiceRepository.list(actor.clinicId, invoiceFilter, { limit: STATEMENT_LINES }),
    paymentRepository.list(actor.clinicId, paymentFilter, { limit: STATEMENT_LINES }),
    invoiceRepository.totals(actor.clinicId, invoiceFilter),
  ])

  const today = localDateIn(clinic.timezone, now)
  return {
    currency: clinic.currency,
    invoiced: totals.invoiced,
    paid: totals.paid,
    outstanding: totals.outstanding,
    invoices: invoices.items.map((invoice) => toInvoiceSummary(invoice, today)),
    payments: payments.items.map(toPayment),
    hasMoreInvoices: invoices.nextCursor !== null,
    hasMorePayments: payments.nextCursor !== null,
  }
}
