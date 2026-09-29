import {
  addAmounts,
  isNegativeAmount,
  normalizeAmount,
  zeroAmount,
  type AcceptTreatmentPlanRequest,
  type BillPlanItemRequest,
  type CancelTreatmentPlanRequest,
  type DeclineTreatmentPlanRequest,
  type OverduePlan,
  type OverduePlansQuery,
  type PersonRef,
  type PlanItemBilled,
  type TreatmentPlan,
  type TreatmentPlanInput,
  type TreatmentPlanListQuery,
} from '@clinic/contracts'
import type { TreatmentPlanStatus } from '@clinic/config'
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../errors'
import { pageLimit, type Page } from '../../../pagination'
import { runInTransaction, type Transaction } from '../../../transaction'
import { assertCan, type Actor } from '../../access'
import { nextAppointmentsFor } from '../../appointments'
import {
  billToEncounter,
  computeLine,
  computeTotals,
  findServicesForInvoicing,
} from '../../billing'
import { findEncounterOwner } from '../../clinical'
import { getClinicFacts } from '../../clinic'
import { getFile } from '../../files'
import { listPatientsByIds, type PatientDentalFacts } from '../../patients'
import {
  canBill,
  canCancel,
  canDecide,
  canPresent,
  defaultQuantity,
  describeWork,
  isEditable,
  itemState,
  statusAfterProgress,
} from '../domain/plan'
import { catalogueRepository } from '../infrastructure/catalogue.repository'
import {
  treatmentPlanRepository,
  type ItemProgress,
  type NewPlanItem,
  type StoredPlan,
} from '../infrastructure/treatment-plan.repository'
import { toothRecordRepository } from '../infrastructure/tooth-record.repository'
import { patientForChart } from './scope'

/**
 * Treatment plans (Phase 12, ADR-0036).
 *
 * A plan is read and written under the chart's own permissions: it is the chart's planned work,
 * gathered and priced. What the plan owns is the money and the patient's answer; whether an item
 * is done is the chart's to say, and `syncPlansFor` keeps the plan's cached copy of that in step
 * whenever a planned row is completed or voided.
 */

const iso = (date: Date | null) => (date ? date.toISOString() : null)
const personOf = (actor: Actor): PersonRef => ({ id: actor.userId, name: actor.displayName })

type Problem = { field: string; issue: string }
const refuse = (problems: Problem[]): never => {
  throw new ValidationError('This plan cannot be saved as it is.', problems)
}

export function toTreatmentPlan(plan: StoredPlan): TreatmentPlan {
  const open = plan.items.filter((item) => item.state === 'OPEN')
  return {
    id: plan.id,
    patientId: plan.patientId,
    title: plan.title,
    status: plan.status,
    phases: [...plan.phases],
    items: plan.items.map((item) => ({
      id: item.id,
      toothRecordId: item.toothRecordId,
      phase: item.phase,
      teeth: item.teeth.map((tooth) => ({ fdi: tooth.fdi, role: tooth.role })),
      surfaces: [...item.surfaces],
      treatment: { ...item.treatment },
      serviceId: item.serviceId,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      taxRatePercent: item.taxRatePercent,
      gross: item.gross,
      net: item.net,
      tax: item.tax,
      lineTotal: item.lineTotal,
      state: item.state,
      doneOn: item.doneOn,
      completedByRecordId: item.completedByRecordId,
      completedInEncounterId: item.completedInEncounterId,
      billed:
        item.billedInvoiceId && item.billedInvoiceNumber && item.billedAt
          ? {
              invoiceId: item.billedInvoiceId,
              invoiceNumber: item.billedInvoiceNumber,
              at: item.billedAt.toISOString(),
            }
          : null,
    })),
    currency: plan.currency,
    subtotal: plan.subtotal,
    discountTotal: plan.discountTotal,
    taxTotal: plan.taxTotal,
    total: plan.total,
    remaining: addAmounts(plan.currency, ...open.map((item) => item.lineTotal)),
    progress: {
      done: plan.items.filter((item) => item.state === 'DONE').length,
      open: open.length,
      dropped: plan.items.filter((item) => item.state === 'DROPPED').length,
    },
    notes: plan.notes,
    createdBy: plan.createdBy,
    createdAt: plan.createdAt.toISOString(),
    presentedAt: iso(plan.presentedAt),
    decision: plan.decidedAt
      ? {
          at: plan.decidedAt.toISOString(),
          recordedBy: plan.decisionRecordedBy,
          signedBy: plan.signedBy,
          signatureFileId: plan.signatureFileId,
          reason: plan.declineReason,
        }
      : null,
    cancelled: plan.cancelledAt
      ? {
          at: plan.cancelledAt.toISOString(),
          by: plan.cancelledBy,
          reason: plan.cancelReason ?? '',
        }
      : null,
  }
}

/**
 * Prices what the plan asks for, and checks every item against the chart before anything is
 * written: each must be a live, not yet done PLANNED row of this patient's, named once.
 *
 * The price comes from the price list through the treatment's service unless the plan names one;
 * a treatment with no service has no price to fall back on, so the plan must name it. Tax follows
 * the service. Amounts are refused, not rounded, when the currency cannot express them.
 */
async function priceItems(
  clinicId: string,
  patient: PatientDentalFacts,
  input: TreatmentPlanInput,
  currency: string,
): Promise<{ items: NewPlanItem[]; totals: ReturnType<typeof computeTotals> }> {
  const problems: Problem[] = []
  const seen = new Set<string>()
  input.items.forEach((item, index) => {
    if (item.phase >= input.phases.length) {
      problems.push({ field: `items.${index}.phase`, issue: 'NO_SUCH_PHASE' })
    }
    if (seen.has(item.toothRecordId)) {
      problems.push({ field: `items.${index}.toothRecordId`, issue: 'DUPLICATE_ITEM' })
    }
    seen.add(item.toothRecordId)
  })
  if (problems.length > 0) refuse(problems)

  const recordIds = input.items.map((item) => item.toothRecordId)
  const [records, completions] = await Promise.all([
    toothRecordRepository.findByIds(clinicId, recordIds),
    toothRecordRepository.completionsOf(clinicId, recordIds),
  ])
  const treatments = await catalogueRepository.findTreatments(clinicId, [
    ...new Set([...records.values()].map((record) => record.treatmentId)),
  ])
  const serviceIds = [...treatments.values()]
    .map((treatment) => treatment.serviceId)
    .filter((id): id is string => Boolean(id))
  const services = await findServicesForInvoicing(clinicId, serviceIds)

  const items: NewPlanItem[] = []
  input.items.forEach((item, index) => {
    const at = (field: string) => `items.${index}.${field}`
    const record = records.get(item.toothRecordId)
    if (!record || record.patientId !== patient.id) {
      problems.push({ field: at('toothRecordId'), issue: 'NOT_FOUND' })
      return
    }
    if (record.voidedAt || record.status !== 'PLANNED') {
      problems.push({ field: at('toothRecordId'), issue: 'NOT_PLANNED' })
      return
    }
    if (completions.has(record.id)) {
      problems.push({ field: at('toothRecordId'), issue: 'ALREADY_DONE' })
      return
    }

    const serviceId = treatments.get(record.treatmentId)?.serviceId ?? null
    const service = serviceId ? services.get(serviceId) : undefined
    const priced = service?.isActive ? service : undefined
    const unitPrice = item.unitPrice ?? priced?.price ?? null
    if (unitPrice === null) {
      problems.push({ field: at('unitPrice'), issue: 'PRICE_REQUIRED' })
      return
    }
    for (const [field, amount] of [
      ['unitPrice', unitPrice],
      ['discount', item.discount],
    ] as const) {
      if (normalizeAmount(amount, currency) === null) {
        problems.push({ field: at(field), issue: 'INVALID_AMOUNT' })
        return
      }
    }

    const line = computeLine(
      {
        serviceId: priced?.id ?? null,
        description: describeWork({
          name: record.treatment.name,
          teeth: record.teeth,
          surfaces: record.surfaces,
        }),
        quantity:
          item.quantity ?? defaultQuantity({ scope: record.treatment.scope, teeth: record.teeth }),
        unitPrice,
        discount: item.discount,
        taxRatePercent: priced?.taxRatePercent ?? '0',
      },
      currency,
    )
    if (isNegativeAmount(line.net)) {
      problems.push({ field: at('discount'), issue: 'TOO_LARGE' })
      return
    }
    items.push({
      toothRecordId: record.id,
      phase: item.phase,
      teeth: record.teeth.map((tooth) => ({ fdi: tooth.fdi, role: tooth.role })),
      surfaces: [...record.surfaces],
      treatment: {
        id: record.treatmentId,
        code: record.treatment.code,
        name: record.treatment.name,
        symbol: record.treatment.symbol,
      },
      serviceId: line.serviceId,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      taxRatePercent: line.taxRatePercent,
      gross: line.gross,
      net: line.net,
      tax: line.tax,
      lineTotal: line.lineTotal,
    })
  })
  if (problems.length > 0) refuse(problems)

  // The totals are the sum of the rounded lines, as an invoice's are.
  const totals = computeTotals(
    items.map((item) => ({
      serviceId: item.serviceId,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      taxRatePercent: item.taxRatePercent,
    })),
    currency,
  )
  return { items, totals }
}

/** A plan, once the caller may do `permission` on its patient's chart. */
async function planFor(
  actor: Actor,
  planId: string,
  permission: 'dental:read' | 'dental:write',
): Promise<{ plan: StoredPlan; patient: PatientDentalFacts }> {
  const facts = await treatmentPlanRepository.findAccessFacts(actor.clinicId, planId)
  if (!facts) throw new NotFoundError('Treatment plan')
  const patient = await patientForChart(actor, facts.patientId, permission)
  const plan = await treatmentPlanRepository.findById(actor.clinicId, planId)
  if (!plan) throw new NotFoundError('Treatment plan')
  return { plan, patient }
}

const wrongState = (status: TreatmentPlanStatus): never => {
  throw new ConflictError(
    'PLAN_STATE',
    `A plan that is ${status.toLowerCase()} cannot be changed that way.`,
  )
}

export async function listTreatmentPlans(
  actor: Actor,
  patientId: string,
  query: TreatmentPlanListQuery,
): Promise<Page<TreatmentPlan>> {
  const patient = await patientForChart(actor, patientId, 'dental:read')
  const page = await treatmentPlanRepository.listForPatient(
    actor.clinicId,
    patient.id,
    { status: query.status },
    { cursor: query.cursor, limit: pageLimit(query.limit) },
  )
  return { items: page.items.map(toTreatmentPlan), nextCursor: page.nextCursor }
}

export async function getTreatmentPlan(actor: Actor, planId: string): Promise<TreatmentPlan> {
  const { plan } = await planFor(actor, planId, 'dental:read')
  return toTreatmentPlan(plan)
}

export async function createTreatmentPlan(
  actor: Actor,
  patientId: string,
  input: TreatmentPlanInput,
): Promise<TreatmentPlan> {
  const patient = await patientForChart(actor, patientId, 'dental:write')
  const clinic = await getClinicFacts(actor.clinicId)
  const { items, totals } = await priceItems(actor.clinicId, patient, input, clinic.currency)
  const plan = await treatmentPlanRepository.create({
    clinicId: actor.clinicId,
    patientId: patient.id,
    title: input.title,
    phases: input.phases.map((phase) => phase.name),
    items,
    currency: clinic.currency,
    totals,
    notes: input.notes,
    createdBy: personOf(actor),
  })
  return toTreatmentPlan(plan)
}

/** Rewrites a draft or a presented plan; a presented one goes back to DRAFT to be shown again. */
export async function updateTreatmentPlan(
  actor: Actor,
  planId: string,
  input: TreatmentPlanInput,
): Promise<TreatmentPlan> {
  const { plan, patient } = await planFor(actor, planId, 'dental:write')
  if (!isEditable(plan.status)) wrongState(plan.status)
  const { items, totals } = await priceItems(actor.clinicId, patient, input, plan.currency)
  const updated = await treatmentPlanRepository.replaceContent(actor.clinicId, plan.id, {
    title: input.title,
    phases: input.phases.map((phase) => phase.name),
    items,
    totals,
    notes: input.notes,
  })
  if (!updated) wrongState(plan.status)
  return toTreatmentPlan(updated!)
}

export async function presentTreatmentPlan(
  actor: Actor,
  planId: string,
  now: Date = new Date(),
): Promise<TreatmentPlan> {
  const { plan } = await planFor(actor, planId, 'dental:write')
  if (!canPresent(plan.status)) wrongState(plan.status)
  const updated = await treatmentPlanRepository.transition(
    actor.clinicId,
    plan.id,
    ['DRAFT', 'PRESENTED'],
    { status: 'PRESENTED', presentedAt: now },
  )
  if (!updated) wrongState(plan.status)
  return toTreatmentPlan(updated!)
}

/**
 * The patient says yes. Every item must still be open work on the chart, and none of it may
 * already be in another plan the patient agreed to — two agreed plans for the same crown would
 * bill it twice. The signature, when there is one, must be a document on this patient's file.
 */
export async function acceptTreatmentPlan(
  actor: Actor,
  planId: string,
  input: AcceptTreatmentPlanRequest,
  now: Date = new Date(),
): Promise<TreatmentPlan> {
  const { plan, patient } = await planFor(actor, planId, 'dental:write')
  if (!canDecide(plan.status)) wrongState(plan.status)

  if (input.signatureFileId) {
    const file = await getFile(actor, input.signatureFileId).catch(() => null)
    if (!file || file.ownerType !== 'PATIENT' || file.ownerId !== patient.id) {
      refuse([{ field: 'signatureFileId', issue: 'NOT_FOUND' }])
    }
  }

  const recordIds = plan.items.map((item) => item.toothRecordId)
  const [records, completions, agreed] = await Promise.all([
    toothRecordRepository.findByIds(actor.clinicId, recordIds),
    toothRecordRepository.completionsOf(actor.clinicId, recordIds),
    treatmentPlanRepository.findContaining(actor.clinicId, recordIds, ['ACCEPTED']),
  ])
  const stale = plan.items.filter((item) => {
    const record = records.get(item.toothRecordId)
    return !record || record.voidedAt || completions.has(item.toothRecordId)
  })
  if (stale.length > 0) {
    throw new ConflictError(
      'PLAN_OUT_OF_DATE',
      'Some of this plan has been done or voided on the chart since it was drawn up. Edit the plan first.',
    )
  }
  if (agreed.some((other) => other.id !== plan.id)) {
    throw new ConflictError(
      'ALREADY_AGREED',
      'Some of this work is already in a plan the patient has agreed to.',
    )
  }

  const updated = await treatmentPlanRepository.transition(
    actor.clinicId,
    plan.id,
    ['DRAFT', 'PRESENTED'],
    {
      status: 'ACCEPTED',
      presentedAt: plan.presentedAt ?? now,
      decidedAt: now,
      acceptedAt: now,
      decisionRecordedBy: personOf(actor),
      signedBy: input.signedBy,
      signatureFileId: input.signatureFileId,
      declineReason: null,
    },
  )
  if (!updated) wrongState(plan.status)
  return toTreatmentPlan(updated!)
}

export async function declineTreatmentPlan(
  actor: Actor,
  planId: string,
  input: DeclineTreatmentPlanRequest,
  now: Date = new Date(),
): Promise<TreatmentPlan> {
  const { plan } = await planFor(actor, planId, 'dental:write')
  if (!canDecide(plan.status)) wrongState(plan.status)
  const updated = await treatmentPlanRepository.transition(
    actor.clinicId,
    plan.id,
    ['DRAFT', 'PRESENTED'],
    {
      status: 'DECLINED',
      decidedAt: now,
      decisionRecordedBy: personOf(actor),
      declineReason: input.reason,
    },
  )
  if (!updated) wrongState(plan.status)
  return toTreatmentPlan(updated!)
}

export async function cancelTreatmentPlan(
  actor: Actor,
  planId: string,
  input: CancelTreatmentPlanRequest,
  now: Date = new Date(),
): Promise<TreatmentPlan> {
  const { plan } = await planFor(actor, planId, 'dental:write')
  if (!canCancel(plan.status)) wrongState(plan.status)
  const updated = await treatmentPlanRepository.transition(
    actor.clinicId,
    plan.id,
    ['DRAFT', 'PRESENTED', 'ACCEPTED'],
    {
      status: 'CANCELLED',
      cancelledAt: now,
      cancelledBy: personOf(actor),
      cancelReason: input.reason,
    },
  )
  if (!updated) wrongState(plan.status)
  return toTreatmentPlan(updated!)
}

/**
 * Putting done work on a visit's invoice, at the price the patient agreed to (Phase 12).
 *
 * Nothing is billed on its own: completing planned work only makes the item billable, and a person
 * with `invoice:create` decides to bill it. The line goes on the visit's open draft, or starts one,
 * through billing's own seam; the item is claimed in the same transaction, so a second press — or
 * a second person — finds it already billed and the invoice is not charged twice.
 */
export async function billPlanItem(
  actor: Actor,
  planId: string,
  itemId: string,
  input: BillPlanItemRequest,
  now: Date = new Date(),
): Promise<PlanItemBilled> {
  await assertCan(actor, 'invoice:create')
  const { plan, patient } = await planFor(actor, planId, 'dental:write')
  if (!canBill(plan.status)) {
    throw new ConflictError('PLAN_NOT_AGREED', 'Only work in an agreed plan is billed from it.')
  }
  const item = plan.items.find((candidate) => candidate.id === itemId)
  if (!item) throw new NotFoundError('Plan item')
  if (item.state !== 'DONE') {
    throw new ConflictError('NOT_DONE', 'This work has not been done yet.')
  }
  if (item.billedInvoiceId) {
    throw new ConflictError(
      'ALREADY_BILLED',
      `This is already on invoice ${item.billedInvoiceNumber}.`,
    )
  }

  const visit = await findEncounterOwner(actor.clinicId, input.encounterId)
  if (!visit || visit.patientId !== patient.id) {
    refuse([{ field: 'encounterId', issue: 'NOT_THIS_PATIENTS_VISIT' }])
  }
  if (visit!.status === 'CANCELLED') {
    throw new BusinessRuleError('ENCOUNTER_CANCELLED', 'That visit was cancelled.')
  }

  return runInTransaction(async (tx: Transaction) => {
    const bill = await billToEncounter(
      actor,
      { id: visit!.id, patientId: patient.id },
      [
        {
          serviceId: item.serviceId,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          taxRatePercent: item.taxRatePercent,
        },
      ],
      tx,
      now,
    )
    if (!bill) throw new ConflictError('NOTHING_TO_BILL', 'There was nothing to bill.')
    const claimed = await treatmentPlanRepository.markBilled(
      actor.clinicId,
      plan.id,
      item.id,
      { invoiceId: bill.invoiceId, invoiceNumber: bill.invoiceNumber, at: now },
      tx,
    )
    // Somebody billed it a moment ago; the transaction unwinds and the invoice is untouched.
    if (!claimed) throw new ConflictError('ALREADY_BILLED', 'This has just been billed.')
    return bill
  })
}

/**
 * Brings every plan that has this planned row as an item back in step with the chart: which
 * items are done, on what day and in which visit, which were dropped, how many are open, and —
 * for an agreed plan — whether that makes it complete, or no longer complete.
 *
 * Called after a planned row is completed or voided, or a completion of one is voided. It reads
 * the chart afresh rather than trusting what the caller saw, so running it twice is harmless.
 */
export async function syncPlansFor(clinicId: string, plannedRecordId: string): Promise<void> {
  const plans = await treatmentPlanRepository.findContaining(clinicId, [plannedRecordId])
  for (const plan of plans) {
    if (plan.status === 'CANCELLED' || plan.status === 'DECLINED') continue
    const recordIds = plan.items.map((item) => item.toothRecordId)
    const [records, completions] = await Promise.all([
      toothRecordRepository.findByIds(clinicId, recordIds),
      toothRecordRepository.completionDetailsOf(clinicId, recordIds),
    ])
    const progress: ItemProgress[] = plan.items.map((item) => {
      const record = records.get(item.toothRecordId)
      const completion = completions.get(item.toothRecordId) ?? null
      const state = itemState({ voided: !record || Boolean(record.voidedAt) }, completion)
      return {
        itemId: item.id,
        state,
        doneOn: state === 'DONE' ? completion!.performedOn : null,
        completedByRecordId: state === 'DONE' ? completion!.recordId : null,
        completedInEncounterId: state === 'DONE' ? completion!.encounterId : null,
      }
    })
    const open = progress.filter((item) => item.state === 'OPEN').length
    const done = progress.filter((item) => item.state === 'DONE').length
    await treatmentPlanRepository.setProgress(
      clinicId,
      plan.id,
      progress,
      open,
      statusAfterProgress(plan.status, { open, done }),
    )
  }
}

/**
 * Recall: agreed plans with work still to do, agreed at least `olderThanDays` ago, longest-waiting
 * first — by default only for patients with nothing booked, since those are the ones to phone.
 *
 * A clinic-wide list, so it asks for the chart at clinic scope: a doctor who reads only the charts
 * of their own patients is not handed a list of everybody's.
 */
export async function listOverduePlans(
  actor: Actor,
  query: OverduePlansQuery,
  now: Date = new Date(),
): Promise<Page<OverduePlan>> {
  const scope = actor.permissions.get('dental:read')
  if (scope !== 'CLINIC' && scope !== 'GLOBAL') throw new ForbiddenError('dental:read')

  const acceptedBefore = new Date(now.getTime() - query.olderThanDays * 24 * 60 * 60 * 1000)
  const booked = new Map<string, Date>()
  const page = await treatmentPlanRepository.listOverdue(
    actor.clinicId,
    acceptedBefore,
    { cursor: query.cursor, limit: pageLimit(query.limit) },
    async (plans) => {
      const next = await nextAppointmentsFor(
        actor.clinicId,
        [...new Set(plans.map((plan) => plan.patientId))],
        now,
      )
      for (const [patientId, at] of next) booked.set(patientId, at)
      return query.unbooked ? plans.filter((plan) => !next.has(plan.patientId)) : plans
    },
  )

  const patients = new Map(
    (await listPatientsByIds(actor, [...new Set(page.items.map((plan) => plan.patientId))])).map(
      (patient) => [patient.id, patient],
    ),
  )
  return {
    items: page.items.flatMap((plan): OverduePlan[] => {
      const patient = patients.get(plan.patientId)
      if (!patient) return []
      const open = plan.items.filter((item) => item.state === 'OPEN')
      return [
        {
          planId: plan.id,
          title: plan.title,
          patient: {
            id: patient.id,
            name: `${patient.firstName} ${patient.lastName}`,
            medicalRecordNo: patient.medicalRecordNo,
            phone: patient.phone,
          },
          acceptedAt: (plan.acceptedAt ?? plan.createdAt).toISOString(),
          openItems: open.length,
          totalItems: plan.items.filter((item) => item.state !== 'DROPPED').length,
          remaining:
            open.length > 0
              ? addAmounts(plan.currency, ...open.map((item) => item.lineTotal))
              : zeroAmount(plan.currency),
          currency: plan.currency,
          nextAppointmentAt: iso(booked.get(plan.patientId) ?? null),
        },
      ]
    }),
    nextCursor: page.nextCursor,
  }
}
