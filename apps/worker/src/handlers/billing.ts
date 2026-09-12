import { assertEventPayload, type OutboxEnvelope } from '@clinic/events'
import { findInvoiceForNotification, findPaymentForNotification } from '@clinic/core/billing'
import { deliver } from '@clinic/core/notifications'
import { findPatientForScheduling } from '@clinic/core/patients'

/**
 * Money changing hands is something a patient hears about — but only where there is a portal
 * account for it to land in. A patient without one loses the ping and nothing else: the invoice
 * and the receipt are already on their statement of account, which the front desk can print.
 */
export async function onInvoiceIssued(envelope: OutboxEnvelope): Promise<void> {
  const { invoiceId } = assertEventPayload('invoice.issued', envelope.payload)
  const invoice = await findInvoiceForNotification(envelope.clinicId, invoiceId)
  if (!invoice) return

  const userId = await portalAccountFor(envelope.clinicId, invoice.patientId)
  if (!userId) return

  await deliver({
    clinicId: envelope.clinicId,
    userIds: [userId],
    type: 'INVOICE_ISSUED',
    title: `Invoice ${invoice.number}`,
    body: `${invoice.total} ${invoice.currency} is due${invoice.dueAt ? ` by ${invoice.dueAt}` : ''}.`,
    emailBody: `Invoice ${invoice.number} for ${invoice.total} ${invoice.currency} has been issued${
      invoice.dueAt ? ` and is due by ${invoice.dueAt}` : ''
    }.\n\nYou can see it, and everything else on your account, in the patient portal.`,
    href: '/patient/billing',
    entity: { type: 'Invoice', id: invoice.id },
    action: { href: '/patient/billing', label: 'View your bills' },
    dedupeKey: `invoice.issued:${invoice.id}`,
  })
}

export async function onPaymentRecorded(envelope: OutboxEnvelope): Promise<void> {
  const { paymentId } = assertEventPayload('payment.recorded', envelope.payload)
  const payment = await findPaymentForNotification(envelope.clinicId, paymentId)
  if (!payment) return

  const userId = await portalAccountFor(envelope.clinicId, payment.patientId)
  if (!userId) return

  await deliver({
    clinicId: envelope.clinicId,
    userIds: [userId],
    type: 'PAYMENT_RECEIVED',
    title: 'Payment received',
    body: `${payment.amount} ${payment.currency} — thank you.`,
    href: '/patient/billing',
    entity: { type: 'Payment', id: payment.id },
    dedupeKey: `payment.recorded:${payment.id}`,
  })
}

/** A patient's portal account, or null where they have never been invited to one. */
async function portalAccountFor(clinicId: string, patientId: string): Promise<string | null> {
  const patient = await findPatientForScheduling(clinicId, patientId)
  return patient?.userId ?? null
}
