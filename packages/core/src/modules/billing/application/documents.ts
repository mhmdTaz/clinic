import { localDateIn } from '@clinic/contracts'
import type { DownloadLink } from '@clinic/contracts'
import { NotFoundError } from '../../../errors'
import { assertCan, type Actor } from '../../access'
import { getClinicLetterhead, type ClinicLetterhead } from '../../clinic'
import { getDownloadLink, storeGeneratedFile } from '../../files'

import { invoiceRepository } from '../infrastructure/invoice.repository'
import { paymentRepository } from '../infrastructure/payment.repository'
import { renderInvoicePdf, renderReceiptPdf, type Letterhead } from '../infrastructure/pdf-renderer'
import { billingResource } from './scope'

const letterheadOf = (clinic: ClinicLetterhead): Letterhead => ({
  name: clinic.name,
  legalName: clinic.legalName,
  taxId: clinic.taxId,
  addressLines: clinic.addressLines,
  contact: [clinic.phone, clinic.email].filter(Boolean).join('  ·  ') || null,
})

/**
 * The printable invoice (S7, P8), rendered on first request and then stored (ADR-0026).
 *
 * The end state is the one the queued job in section 13.5 would produce — a file in the store,
 * its id on the invoice — so moving this to a worker later changes when it runs, not what
 * exists afterwards.
 *
 * The document belongs to the clinic, not to whoever pressed Print: a patient downloading their
 * own invoice must not appear in the file's history as its source.
 */
export async function getInvoicePdf(actor: Actor, invoiceId: string): Promise<DownloadLink> {
  const facts = await invoiceRepository.findAccessFacts(actor.clinicId, invoiceId)
  if (!facts) throw new NotFoundError('Invoice')
  await assertCan(actor, 'invoice:read', billingResource(actor, 'Invoice', facts))

  if (facts.pdfFileId) return getDownloadLink(actor, facts.pdfFileId)

  const [invoice, clinic] = await Promise.all([
    invoiceRepository.findById(actor.clinicId, invoiceId),
    getClinicLetterhead(actor.clinicId),
  ])
  if (!invoice) throw new NotFoundError('Invoice')

  const body = await renderInvoicePdf({
    clinic: letterheadOf(clinic),
    number: invoice.number,
    status: invoice.status,
    issuedOn: invoice.issuedAt ? localDateIn(clinic.timezone, invoice.issuedAt) : null,
    dueOn: invoice.dueAt,
    currency: invoice.currency,
    patient: invoice.patient,
    lines: invoice.lines,
    subtotal: invoice.subtotal,
    discountTotal: invoice.discountTotal,
    taxTotal: invoice.taxTotal,
    total: invoice.total,
    amountPaid: invoice.amountPaid,
    balanceDue: invoice.balanceDue,
    notes: invoice.notes,
  })

  const file = await storeGeneratedFile({
    clinicId: actor.clinicId,
    ownerType: 'PATIENT',
    ownerId: invoice.patientId,
    patientId: invoice.patientId,
    category: 'OTHER',
    fileName: `${invoice.number}.pdf`,
    mimeType: 'application/pdf',
    body,
    // A patient's own bill is theirs to read (P8).
    isPatientVisible: true,
    generatedBy: { id: 'system', name: clinic.name },
  })

  const attached = await invoiceRepository.attachPdf(actor.clinicId, invoiceId, file.id)
  return getDownloadLink(actor, attached)
}

/** The receipt for money taken (S8, P8). Same render-once-and-store as the invoice. */
export async function getReceiptPdf(actor: Actor, paymentId: string): Promise<DownloadLink> {
  const facts = await paymentRepository.findAccessFacts(actor.clinicId, paymentId)
  if (!facts) throw new NotFoundError('Payment')
  await assertCan(actor, 'payment:read', billingResource(actor, 'Payment', facts))

  if (facts.pdfFileId) return getDownloadLink(actor, facts.pdfFileId)

  const [payment, clinic] = await Promise.all([
    paymentRepository.findById(actor.clinicId, paymentId),
    getClinicLetterhead(actor.clinicId),
  ])
  if (!payment) throw new NotFoundError('Payment')

  const body = await renderReceiptPdf({
    clinic: letterheadOf(clinic),
    number: payment.number,
    receivedOn: localDateIn(clinic.timezone, payment.receivedAt),
    currency: payment.currency,
    patient: payment.patient,
    amount: payment.amount,
    refundedAmount: payment.refundedAmount,
    method: payment.method,
    reference: payment.reference,
    allocations: payment.allocations,
    receivedBy: payment.receivedBy?.name ?? null,
  })

  const file = await storeGeneratedFile({
    clinicId: actor.clinicId,
    ownerType: 'PATIENT',
    ownerId: payment.patientId,
    patientId: payment.patientId,
    category: 'OTHER',
    fileName: `${payment.number}.pdf`,
    mimeType: 'application/pdf',
    body,
    isPatientVisible: true,
    generatedBy: { id: 'system', name: clinic.name },
  })

  const attached = await paymentRepository.attachPdf(actor.clinicId, paymentId, file.id)
  return getDownloadLink(actor, attached)
}
