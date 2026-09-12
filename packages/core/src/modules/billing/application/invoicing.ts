import { isZeroAmount, localDateIn, normalizeAmount } from '@clinic/contracts'
import type {
  CreateInvoiceRequest,
  InvoiceDetail,
  InvoiceLineInput,
  InvoiceListQuery,
  InvoiceSummary,
  IssueInvoiceRequest,
  UpdateInvoiceRequest,
  VoidInvoiceRequest,
} from '@clinic/contracts'
import { INVOICE_DUE_DAYS_DEFAULT } from '@clinic/config'
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../errors'
import type { Transaction } from '../../../transaction'
import { recordAudit } from '../../audit'
import { assertCan, careRelationship, type Actor } from '../../access'
import { getClinicFacts } from '../../clinic'
import { findEncounterOwner } from '../../clinical'
import { findDoctorForBilling } from '../../doctors'
import { findPatientForScheduling } from '../../patients'
import { instantOf, nextDate } from '../../scheduling'

import { canVoid, isEditable, isOverdue } from '../domain/invoice'
import { computeTotals, lineDiscountExceedsGross, type ComputedTotals } from '../domain/totals'
import {
  invoiceRepository,
  type InvoiceFilter,
  type StoredInvoice,
} from '../infrastructure/invoice.repository'
import { billingResource } from './scope'

export function toInvoiceSummary(invoice: StoredInvoice, today: string): InvoiceSummary {
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    patient: {
      id: invoice.patientId,
      name: invoice.patient.name,
      medicalRecordNo: invoice.patient.medicalRecordNo,
    },
    encounterId: invoice.encounterId,
    issuedAt: invoice.issuedAt ? invoice.issuedAt.toISOString() : null,
    dueAt: invoice.dueAt,
    currency: invoice.currency,
    total: invoice.total,
    amountPaid: invoice.amountPaid,
    balanceDue: invoice.balanceDue,
    isOverdue: isOverdue(invoice.status, invoice.dueAt, today),
  }
}

export function toInvoiceDetail(invoice: StoredInvoice, today: string): InvoiceDetail {
  return {
    ...toInvoiceSummary(invoice, today),
    branchId: invoice.branchId,
    lines: invoice.lines,
    subtotal: invoice.subtotal,
    discountTotal: invoice.discountTotal,
    taxTotal: invoice.taxTotal,
    notes: invoice.notes,
    pdfFileId: invoice.pdfFileId,
    voidedAt: invoice.voidedAt ? invoice.voidedAt.toISOString() : null,
    voidReason: invoice.voidReason,
    createdAt: invoice.createdAt ? invoice.createdAt.toISOString() : null,
    createdBy: invoice.createdBy,
  }
}

/**
 * Every amount on a line has to be one the currency can express, and no discount may exceed the
 * line it sits on. Both are refusals rather than corrections: silently rounding "45.005" or
 * clamping an over-large discount would change what somebody typed into what we preferred.
 */
function validateLines(lines: InvoiceLineInput[], currency: string): ComputedTotals {
  lines.forEach((line, index) => {
    for (const field of ['unitPrice', 'discount'] as const) {
      if (normalizeAmount(line[field], currency) === null) {
        throw new ValidationError('That amount is not valid for this clinic’s currency.', [
          { field: `lines.${index}.${field}`, issue: 'INVALID_AMOUNT' },
        ])
      }
    }
    if (lineDiscountExceedsGross(line, currency)) {
      throw new ValidationError('A discount cannot be larger than the line it is on.', [
        { field: `lines.${index}.discount`, issue: 'TOO_LARGE' },
      ])
    }
  })
  return computeTotals(lines, currency)
}

/**
 * Drawing up a bill (S7).
 *
 * Against an encounter with no lines given, it starts from the doctor's consultation fee — the
 * thing that was certainly done — as an editable draft. Guessing the rest of the visit would be
 * worse than a front desk adding two lines.
 */
export async function createInvoice(
  actor: Actor,
  input: CreateInvoiceRequest,
  now: Date = new Date(),
): Promise<InvoiceDetail> {
  await assertCan(
    actor,
    'invoice:create',
    billingResource(actor, 'Invoice', { id: null, patientId: input.patientId }),
  )

  const [clinic, patient] = await Promise.all([
    getClinicFacts(actor.clinicId),
    findPatientForScheduling(actor.clinicId, input.patientId),
  ])
  if (!patient) throw new NotFoundError('Patient')

  let lines = input.lines
  if (input.encounterId) {
    const encounter = await findEncounterOwner(actor.clinicId, input.encounterId)
    if (!encounter) throw new NotFoundError('Encounter')
    if (encounter.patientId !== input.patientId) {
      throw new BusinessRuleError(
        'ENCOUNTER_PATIENT_MISMATCH',
        'That visit belongs to a different patient.',
      )
    }
    if (encounter.status === 'CANCELLED') {
      throw new BusinessRuleError('ENCOUNTER_CANCELLED', 'That visit was cancelled.')
    }

    // Two people billing the same visit at once is the failure this refuses. A second invoice
    // against an already-issued one is legitimate — a lab result that arrives later is its own
    // bill — so only an open draft blocks.
    const drafts = await invoiceRepository.list(actor.clinicId, {
      encounterId: input.encounterId,
      status: 'DRAFT',
    })
    const existing = drafts[0]
    if (existing) {
      throw new ConflictError(
        'INVOICE_DRAFT_EXISTS',
        `This visit already has a draft invoice (${existing.number}).`,
      )
    }

    if (lines.length === 0) {
      lines = await consultationLines(actor.clinicId, encounter.doctorId, clinic.currency)
    }
  }

  if (lines.length === 0) {
    throw new ValidationError('An invoice needs at least one line.', [
      { field: 'lines', issue: 'REQUIRED' },
    ])
  }

  const totals = validateLines(lines, clinic.currency)
  const year = Number(localDateIn(clinic.timezone, now).slice(0, 4))

  const invoice = await invoiceRepository.create({
    clinicId: actor.clinicId,
    number: await invoiceRepository.nextNumber(actor.clinicId, year),
    branchId: input.branchId,
    patientId: patient.id,
    patient: { name: patient.name, medicalRecordNo: patient.medicalRecordNo },
    encounterId: input.encounterId,
    currency: clinic.currency,
    totals,
    notes: input.notes,
    createdBy: { id: actor.userId, name: actor.displayName },
  })

  await recordAudit({
    action: 'invoice.created',
    category: 'FINANCIAL',
    severity: 'INFO',
    clinicId: actor.clinicId,
    entity: { type: 'Invoice', id: invoice.id },
    metadata: {
      number: invoice.number,
      patientId: invoice.patientId,
      encounterId: invoice.encounterId,
      total: invoice.total,
      currency: invoice.currency,
    },
  })

  return toInvoiceDetail(invoice, localDateIn(clinic.timezone, now))
}

/** The one line a consultation is certain to have produced. */
async function consultationLines(
  clinicId: string,
  doctorId: string,
  currency: string,
): Promise<InvoiceLineInput[]> {
  const doctor = await findDoctorForBilling(clinicId, doctorId)
  const fee = doctor?.consultationFee ? normalizeAmount(doctor.consultationFee, currency) : null
  if (!fee || isZeroAmount(fee)) return []
  return [
    {
      serviceId: null,
      description: doctor?.name ? `Consultation — ${doctor.name}` : 'Consultation',
      quantity: '1',
      unitPrice: fee,
      discount: '0',
      taxRatePercent: '0',
    },
  ]
}

export async function updateInvoice(
  actor: Actor,
  invoiceId: string,
  input: UpdateInvoiceRequest,
  now: Date = new Date(),
): Promise<InvoiceDetail> {
  const facts = await invoiceRepository.findAccessFacts(actor.clinicId, invoiceId)
  if (!facts) throw new NotFoundError('Invoice')
  await assertCan(actor, 'invoice:create', billingResource(actor, 'Invoice', facts))

  if (!isEditable(facts.status)) {
    throw new BusinessRuleError(
      'INVOICE_NOT_EDITABLE',
      'Only a draft invoice can be changed. Void it and issue another.',
    )
  }

  const clinic = await getClinicFacts(actor.clinicId)
  const totals = input.lines ? validateLines(input.lines, clinic.currency) : undefined
  if (input.lines && input.lines.length === 0) {
    throw new ValidationError('An invoice needs at least one line.', [
      { field: 'lines', issue: 'REQUIRED' },
    ])
  }

  const invoice = await invoiceRepository.updateDraft(actor.clinicId, invoiceId, {
    totals,
    notes: input.notes,
  })
  // Nothing matched: it was issued between the check and the write.
  if (!invoice) {
    throw new ConflictError('INVOICE_NOT_EDITABLE', 'That invoice was issued a moment ago.')
  }

  return toInvoiceDetail(invoice, localDateIn(clinic.timezone, now))
}

/**
 * Issuing: the moment the document stops being ours and becomes theirs (S7). After this its
 * lines are frozen, because a copy of them is in the patient's hand.
 */
export async function issueInvoice(
  actor: Actor,
  invoiceId: string,
  input: IssueInvoiceRequest,
  now: Date = new Date(),
): Promise<InvoiceDetail> {
  const facts = await invoiceRepository.findAccessFacts(actor.clinicId, invoiceId)
  if (!facts) throw new NotFoundError('Invoice')
  await assertCan(actor, 'invoice:issue', billingResource(actor, 'Invoice', facts))

  const clinic = await getClinicFacts(actor.clinicId)
  const today = localDateIn(clinic.timezone, now)
  const dueAt = input.dueAt ?? addDays(today, INVOICE_DUE_DAYS_DEFAULT)
  if (dueAt < today) {
    throw new ValidationError('An invoice cannot fall due before it is issued.', [
      { field: 'dueAt', issue: 'TOO_EARLY' },
    ])
  }

  const invoice = await invoiceRepository.issue(actor.clinicId, invoiceId, now, dueAt)
  if (!invoice) {
    throw new ConflictError(
      'INVOICE_NOT_DRAFT',
      'That invoice has already been issued or was voided.',
    )
  }

  await recordAudit({
    action: 'invoice.issued',
    category: 'FINANCIAL',
    severity: 'NOTICE',
    clinicId: actor.clinicId,
    entity: { type: 'Invoice', id: invoice.id },
    metadata: {
      number: invoice.number,
      patientId: invoice.patientId,
      total: invoice.total,
      currency: invoice.currency,
      dueAt,
    },
  })

  return toInvoiceDetail(invoice, today)
}

export async function voidInvoice(
  actor: Actor,
  invoiceId: string,
  input: VoidInvoiceRequest,
  now: Date = new Date(),
): Promise<InvoiceDetail> {
  const facts = await invoiceRepository.findAccessFacts(actor.clinicId, invoiceId)
  if (!facts) throw new NotFoundError('Invoice')
  await assertCan(actor, 'invoice:void', billingResource(actor, 'Invoice', facts))

  if (!canVoid(facts.status)) {
    throw new BusinessRuleError(
      'INVOICE_HAS_PAYMENTS',
      'Money has been taken against this invoice. Refund it before voiding.',
    )
  }

  const invoice = await invoiceRepository.void(actor.clinicId, invoiceId, input.reason, now, {
    id: actor.userId,
    name: actor.displayName,
  })
  if (!invoice) {
    throw new ConflictError('INVOICE_NOT_VOIDABLE', 'That invoice changed a moment ago.')
  }

  await recordAudit({
    action: 'invoice.voided',
    category: 'FINANCIAL',
    severity: 'WARNING',
    clinicId: actor.clinicId,
    entity: { type: 'Invoice', id: invoice.id },
    metadata: {
      number: invoice.number,
      patientId: invoice.patientId,
      total: invoice.total,
      currency: invoice.currency,
      reason: input.reason,
    },
  })

  const clinic = await getClinicFacts(actor.clinicId)
  return toInvoiceDetail(invoice, localDateIn(clinic.timezone, now))
}

export async function listInvoices(
  actor: Actor,
  query: InvoiceListQuery,
  now: Date = new Date(),
): Promise<InvoiceSummary[]> {
  const clinic = await getClinicFacts(actor.clinicId)
  const filter = await invoiceFilterFor(actor, query, clinic.timezone)
  const invoices = await invoiceRepository.list(actor.clinicId, filter)
  const today = localDateIn(clinic.timezone, now)
  return invoices.map((invoice) => toInvoiceSummary(invoice, today))
}

export async function getInvoice(
  actor: Actor,
  invoiceId: string,
  now: Date = new Date(),
): Promise<InvoiceDetail> {
  const facts = await invoiceRepository.findAccessFacts(actor.clinicId, invoiceId)
  if (!facts) throw new NotFoundError('Invoice')
  await assertCan(actor, 'invoice:read', billingResource(actor, 'Invoice', facts))

  const [invoice, clinic] = await Promise.all([
    invoiceRepository.findById(actor.clinicId, invoiceId),
    getClinicFacts(actor.clinicId),
  ])
  if (!invoice) throw new NotFoundError('Invoice')
  return toInvoiceDetail(invoice, localDateIn(clinic.timezone, now))
}

/**
 * The scope a list read runs at, turned into a filter. A patient sees their own; a doctor with
 * an ASSIGNED grant sees a patient they have treated, and must name one; the clinic sees all.
 *
 * Shared with the statement of account and the day's report, so the narrowing happens once.
 */
export async function invoiceFilterFor(
  actor: Actor,
  query: InvoiceListQuery,
  timezone: string,
): Promise<InvoiceFilter> {
  await assertCan(actor, 'invoice:read')
  const scope = actor.permissions.get('invoice:read')

  const filter: InvoiceFilter = {
    encounterId: query.encounterId,
    status: query.status,
    outstanding: query.outstanding,
  }
  if (query.from) filter.issuedFrom = instantOf(query.from, '00:00', timezone)
  if (query.to) filter.issuedTo = instantOf(nextDate(query.to), '00:00', timezone)

  if (scope === 'OWN') {
    if (!actor.patientId) throw new ForbiddenError('invoice:read')
    filter.patientId = actor.patientId
    return filter
  }
  if (scope === 'ASSIGNED') {
    if (!actor.doctorId || !query.patientId) throw new ForbiddenError('invoice:read')
    const treats = await careRelationship().hasTreated(
      actor.clinicId,
      actor.doctorId,
      query.patientId,
    )
    if (!treats) throw new ForbiddenError('invoice:read')
    filter.patientId = query.patientId
    return filter
  }
  if (scope === 'CLINIC' || scope === 'GLOBAL') {
    filter.patientId = query.patientId
    return filter
  }
  throw new ForbiddenError('invoice:read')
}

/**
 * Charging a visit for something it consumed (S7, and Phase 6's exit criterion).
 *
 * **No permission check, deliberately.** It is not an authority anybody exercises: a doctor
 * decides what was used, the clinic's own catalogue decides that the thing is billable, and this
 * is the bookkeeping consequence of the two. The caller has already been authorised for the act
 * that caused it — recording consumption — and gating this on `invoice:create` as well would mean
 * a doctor could use a vial but not have the clinic charge for it, which is not a rule anybody
 * asked for. Same reasoning as `getClinicLetterhead`: it answers a use case, never a person.
 *
 * It appends to the visit's open draft where there is one and starts a draft where there is not,
 * and it never touches an issued invoice — a charge arriving after the bill went out is its own
 * bill, exactly as a late lab result is.
 *
 * Runs inside the caller's transaction, so stock, the ledger and the bill move together.
 */
export async function billToEncounter(
  actor: Actor,
  encounter: { id: string; patientId: string },
  lines: InvoiceLineInput[],
  tx: Transaction,
  now: Date = new Date(),
): Promise<{ invoiceId: string; invoiceNumber: string; currency: string; billed: string } | null> {
  if (lines.length === 0) return null

  const [clinic, patient] = await Promise.all([
    getClinicFacts(actor.clinicId),
    findPatientForScheduling(actor.clinicId, encounter.patientId),
  ])
  if (!patient) throw new NotFoundError('Patient')

  const totals = validateLines(lines, clinic.currency)

  const [draft] = await invoiceRepository.list(actor.clinicId, {
    encounterId: encounter.id,
    status: 'DRAFT',
  })

  if (draft) {
    const updated = await invoiceRepository.appendLines(
      actor.clinicId,
      draft.id,
      totals.lines,
      clinic.currency,
      tx,
    )
    // It was issued between the read and the write; start a fresh draft rather than lose the
    // charge, which is the outcome that matters.
    if (updated) {
      return {
        invoiceId: updated.id,
        invoiceNumber: updated.number,
        currency: clinic.currency,
        billed: totals.total,
      }
    }
  }

  const year = Number(localDateIn(clinic.timezone, now).slice(0, 4))
  const created = await invoiceRepository.create(
    {
      clinicId: actor.clinicId,
      number: await invoiceRepository.nextNumber(actor.clinicId, year),
      branchId: null,
      patientId: patient.id,
      patient: { name: patient.name, medicalRecordNo: patient.medicalRecordNo },
      encounterId: encounter.id,
      currency: clinic.currency,
      totals,
      notes: null,
      createdBy: { id: actor.userId, name: actor.displayName },
    },
    tx,
  )

  return {
    invoiceId: created.id,
    invoiceNumber: created.number,
    currency: clinic.currency,
    billed: totals.total,
  }
}

/** Calendar arithmetic on a date string; no zone involved, and no clock. */
function addDays(date: string, days: number): string {
  let cursor = date
  for (let step = 0; step < days; step += 1) cursor = nextDate(cursor)
  return cursor
}

/** For the statement of account: what a patient has been billed, in total. */
export const invoiceTotals = (clinicId: string, filter: InvoiceFilter) =>
  invoiceRepository.totals(clinicId, filter)
