import type { InvoiceStatus, PaymentStatus } from '@clinic/config'
import { compareAmounts, isZeroAmount } from '@clinic/contracts'

/**
 * The invoice lifecycle (section 8.10).
 *
 *   DRAFT ──issue──> ISSUED ──payment──> PARTIALLY_PAID ──payment──> PAID
 *     │                 │                      │
 *     └──void──> VOID <──┘                     └──refund──> ISSUED
 *
 * Only a DRAFT is editable. Once issued, the document has been handed to a patient and its
 * lines are what they were told they owe; changing them afterwards would make the copy in
 * their hand a forgery. A mistake on an issued invoice is corrected by voiding it and issuing
 * another, which is exactly how it works on paper and exactly what an auditor expects to see.
 *
 * Voiding stops at ISSUED for the same reason: an invoice with money against it cannot simply
 * disappear, because the money would have nowhere to be. Refund first, then void.
 *
 * OVERDUE is not in this machine at all. Lateness is a fact about today, not a state a
 * document transitions into, so it is derived on read — see `isOverdue`. The alternative is a
 * nightly sweep whose silent failure leaves every invoice looking current.
 */
export const isEditable = (status: InvoiceStatus): boolean => status === 'DRAFT'
export const canIssue = (status: InvoiceStatus): boolean => status === 'DRAFT'
export const canVoid = (status: InvoiceStatus): boolean => status === 'DRAFT' || status === 'ISSUED'
export const isPayable = (status: InvoiceStatus): boolean =>
  status === 'ISSUED' || status === 'PARTIALLY_PAID'
export const isSettled = (status: InvoiceStatus): boolean => status === 'PAID'

/**
 * Late, as of a calendar date in the clinic's own zone (ADR-0010). A draft is never overdue —
 * nobody has been asked to pay it — and neither is one already paid or voided.
 */
export function isOverdue(status: InvoiceStatus, dueAt: string | null, today: string): boolean {
  if (!isPayable(status) || !dueAt) return false
  // Both are YYYY-MM-DD, so a string comparison is a date comparison.
  return dueAt < today
}

/**
 * The status an invoice lands in once a balance has moved.
 *
 * Written here for the tests and the screens to agree with; the authoritative computation for a
 * payment happens server-side inside the update pipeline, so it can never be decided from a
 * stale read (section 8.10).
 */
export function statusAfterBalance(balanceDue: string, amountPaid: string): InvoiceStatus {
  if (compareAmounts(balanceDue, '0') <= 0) return 'PAID'
  return isZeroAmount(amountPaid) ? 'ISSUED' : 'PARTIALLY_PAID'
}

/** How much of a payment has come back, expressed as the payment's own status. */
export function paymentStatusAfterRefund(amount: string, refundedAmount: string): PaymentStatus {
  if (isZeroAmount(refundedAmount)) return 'COMPLETED'
  return compareAmounts(refundedAmount, amount) >= 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED'
}
