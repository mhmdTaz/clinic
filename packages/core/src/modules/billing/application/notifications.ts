import { invoiceRepository } from '../infrastructure/invoice.repository'
import { paymentRepository } from '../infrastructure/payment.repository'

/**
 * What a background job needs about a bill, with no actor to check.
 *
 * The same shape as the appointments' worker-facing lookup and for the same reason: a reminder is
 * not a request, so there is no scope to enforce, and a narrow named result keeps the worker from
 * growing a dependency on fields it has no business reading.
 */
export interface InvoiceNotificationFacts {
  id: string
  number: string
  patientId: string
  total: string
  currency: string
  dueAt: string | null
}

export async function findInvoiceForNotification(
  clinicId: string,
  invoiceId: string,
): Promise<InvoiceNotificationFacts | null> {
  const invoice = await invoiceRepository.findById(clinicId, invoiceId)
  if (!invoice) return null
  return {
    id: invoice.id,
    number: invoice.number,
    patientId: invoice.patientId,
    total: invoice.total,
    currency: invoice.currency,
    dueAt: invoice.dueAt,
  }
}

export interface PaymentNotificationFacts {
  id: string
  number: string
  patientId: string
  amount: string
  currency: string
}

export async function findPaymentForNotification(
  clinicId: string,
  paymentId: string,
): Promise<PaymentNotificationFacts | null> {
  const payment = await paymentRepository.findById(clinicId, paymentId)
  if (!payment) return null
  return {
    id: payment.id,
    number: payment.number,
    patientId: payment.patientId,
    amount: payment.amount,
    currency: payment.currency,
  }
}
