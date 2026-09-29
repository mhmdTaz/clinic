import {
  localDateIn,
  type ChangeLabOrderStatusRequest,
  type CreateLabOrderRequest,
  type LabOrder,
  type LabOrderListQuery,
  type PatientLabOrderQuery,
  type PersonRef,
  type SetVoiceChartingRequest,
  type VoiceChartingSetting,
} from '@clinic/contracts'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../errors'
import { pageLimit, type Page } from '../../../pagination'
import { assertCan, type Actor } from '../../access'
import { getClinicSessionInfo, setClinicFeatureFlag } from '../../clinic'
import { canMoveLabOrder, isLabOrderOverdue } from '../domain/lab'
import { labOrderRepository, type StoredLabOrder } from '../infrastructure/lab-order.repository'
import { toothRecordRepository } from '../infrastructure/tooth-record.repository'
import { patientForChart } from './scope'

/**
 * Lab work (Phase 13) and the voice-charting switch (ADR-0037).
 *
 * A lab order is part of the chart — it is the crown on the chart, being made — so it is read and
 * written under the chart's permissions, patient by patient. The lab board and the reminders are
 * clinic-wide, and ask for the chart at clinic scope, as the recall list does.
 */

type Problem = { field: string; issue: string }
const refuse = (problems: Problem[]): never => {
  throw new ValidationError('This lab order cannot be saved as it is.', problems)
}
const personOf = (actor: Actor): PersonRef => ({ id: actor.userId, name: actor.displayName })

async function todayAt(clinicId: string, now: Date): Promise<string> {
  const clinic = await getClinicSessionInfo(clinicId)
  return localDateIn(clinic.timezone, now)
}

export function toLabOrder(order: StoredLabOrder, today: string): LabOrder {
  return {
    id: order.id,
    patientId: order.patientId,
    patient: { ...order.patient },
    toothRecordIds: [...order.toothRecordIds],
    teeth: [...order.teeth],
    work: order.work.map((entry) => ({ ...entry })),
    labName: order.labName,
    sentOn: order.sentOn,
    dueOn: order.dueOn,
    status: order.status,
    overdue: isLabOrderOverdue(order.status, order.dueOn, today),
    notes: order.notes,
    history: order.history.map((entry) => ({
      status: entry.status,
      at: entry.at.toISOString(),
      by: entry.by,
      note: entry.note,
      dueOn: entry.dueOn,
    })),
    createdBy: order.createdBy,
    createdAt: order.createdAt.toISOString(),
  }
}

/**
 * Sending work to the lab. It is for rows on this patient's chart that are still live — planned
 * work, usually, or work being done — and it is due on a day no earlier than it was sent.
 */
export async function createLabOrder(
  actor: Actor,
  patientId: string,
  input: CreateLabOrderRequest,
  now: Date = new Date(),
): Promise<LabOrder> {
  const patient = await patientForChart(actor, patientId, 'dental:write')
  const today = await todayAt(actor.clinicId, now)
  const sentOn = input.sentOn ?? today

  const problems: Problem[] = []
  if (sentOn > today) problems.push({ field: 'sentOn', issue: 'IN_THE_FUTURE' })
  if (input.dueOn < sentOn) problems.push({ field: 'dueOn', issue: 'BEFORE_SENT' })

  const ids = [...new Set(input.toothRecordIds)]
  const records = await toothRecordRepository.findByIds(actor.clinicId, ids)
  ids.forEach((id, index) => {
    const record = records.get(id)
    if (!record || record.patientId !== patient.id) {
      problems.push({ field: `toothRecordIds.${index}`, issue: 'NOT_FOUND' })
    } else if (record.voidedAt || (record.status !== 'PLANNED' && record.status !== 'COMPLETED')) {
      problems.push({ field: `toothRecordIds.${index}`, issue: 'NOT_LAB_WORK' })
    }
  })
  if (problems.length > 0) refuse(problems)

  const chosen = ids.map((id) => records.get(id)!)
  const order = await labOrderRepository.create({
    clinicId: actor.clinicId,
    patientId: patient.id,
    patient: { name: patient.name, medicalRecordNo: patient.medicalRecordNo },
    toothRecordIds: ids,
    teeth: [...new Set(chosen.flatMap((record) => record.teeth.map((tooth) => tooth.fdi)))],
    work: chosen.map((record) => ({
      name: record.treatment.name,
      symbol: record.treatment.symbol,
    })),
    labName: input.labName,
    sentOn,
    dueOn: input.dueOn,
    notes: input.notes,
    createdBy: personOf(actor),
    at: now,
  })
  return toLabOrder(order, today)
}

export async function listPatientLabOrders(
  actor: Actor,
  patientId: string,
  query: PatientLabOrderQuery,
  now: Date = new Date(),
): Promise<Page<LabOrder>> {
  const patient = await patientForChart(actor, patientId, 'dental:read')
  const [page, today] = await Promise.all([
    labOrderRepository.listForPatient(
      actor.clinicId,
      patient.id,
      { open: query.open },
      { cursor: query.cursor, limit: pageLimit(query.limit) },
    ),
    todayAt(actor.clinicId, now),
  ])
  return { items: page.items.map((order) => toLabOrder(order, today)), nextCursor: page.nextCursor }
}

/** The clinic's lab board: everybody's work, so the chart at clinic scope. */
export async function listLabOrders(
  actor: Actor,
  query: LabOrderListQuery,
  now: Date = new Date(),
): Promise<Page<LabOrder>> {
  const scope = actor.permissions.get('dental:read')
  if (scope !== 'CLINIC' && scope !== 'GLOBAL') throw new ForbiddenError('dental:read')
  const today = await todayAt(actor.clinicId, now)
  const page = await labOrderRepository.list(
    actor.clinicId,
    { status: query.status, lateBefore: query.overdue ? today : undefined },
    { cursor: query.cursor, limit: pageLimit(query.limit) },
  )
  return { items: page.items.map((order) => toLabOrder(order, today)), nextCursor: page.nextCursor }
}

/**
 * Taking work in, fitting it, sending it back, or calling it off. A remake goes back with the new
 * date the lab gave; a cancellation says why. Every move is a line in the order's history.
 */
export async function changeLabOrderStatus(
  actor: Actor,
  orderId: string,
  input: ChangeLabOrderStatusRequest,
  now: Date = new Date(),
): Promise<LabOrder> {
  const order = await labOrderRepository.findById(actor.clinicId, orderId)
  if (!order) throw new NotFoundError('Lab order')
  await patientForChart(actor, order.patientId, 'dental:write')

  if (!canMoveLabOrder(order.status, input.status)) {
    throw new ConflictError(
      'LAB_ORDER_STATE',
      `Lab work that is ${order.status.toLowerCase()} cannot be marked ${input.status.toLowerCase()}.`,
    )
  }
  const today = await todayAt(actor.clinicId, now)
  if (input.status === 'REMAKE') {
    if (!input.dueOn) refuse([{ field: 'dueOn', issue: 'REQUIRED' }])
    if (input.dueOn! < today) refuse([{ field: 'dueOn', issue: 'IN_THE_PAST' }])
  }
  if (input.status === 'CANCELLED' && !input.note) refuse([{ field: 'note', issue: 'REQUIRED' }])

  const moved = await labOrderRepository.move(actor.clinicId, order.id, order.status, {
    status: input.status,
    at: now,
    by: personOf(actor),
    note: input.note,
    dueOn: input.status === 'REMAKE' ? input.dueOn : null,
  })
  if (!moved) {
    throw new ConflictError('LAB_ORDER_STATE', 'This lab work was updated a moment ago. Reload it.')
  }
  return toLabOrder(moved, today)
}

/** A patient's open lab work, for the chart's drawer. Read with the chart it sits on. */
export async function openLabOrdersFor(
  actor: Actor,
  patientId: string,
  now: Date = new Date(),
): Promise<LabOrder[]> {
  const patient = await patientForChart(actor, patientId, 'dental:read')
  const [orders, today] = await Promise.all([
    labOrderRepository.openForPatient(actor.clinicId, patient.id),
    todayAt(actor.clinicId, now),
  ])
  return orders.map((order) => toLabOrder(order, today))
}

/**
 * Work still at the lab for these patients, for the reminder sweep: bookkeeping on nobody's
 * behalf, which returns what the notice needs and nothing else.
 */
export async function labWorkAtLabFor(
  clinicId: string,
  patientIds: readonly string[],
): Promise<
  Array<{
    id: string
    patientId: string
    patientName: string
    labName: string
    dueOn: string
    work: string[]
    teeth: string[]
  }>
> {
  const orders = await labOrderRepository.atLabFor(clinicId, patientIds)
  return orders.map((order) => ({
    id: order.id,
    patientId: order.patientId,
    patientName: order.patient.name,
    labName: order.labName,
    dueOn: order.dueOn,
    work: order.work.map((entry) => entry.name),
    teeth: [...order.teeth],
  }))
}

/**
 * Turning voice charting on or off (ADR-0037). On is a decision about where the clinic's audio
 * goes — the browser's speech service may send it away to be transcribed — so it is refused
 * unless the administrator has acknowledged that; off needs nothing. The clinic document is
 * audited, so who turned it on, and when, is on the record.
 */
export async function setVoiceCharting(
  actor: Actor,
  input: SetVoiceChartingRequest,
): Promise<VoiceChartingSetting> {
  await assertCan(actor, 'dental:configure')
  if (input.enabled && !input.acknowledged) refuse([{ field: 'acknowledged', issue: 'REQUIRED' }])
  await setClinicFeatureFlag(actor.clinicId, 'dentalVoice', input.enabled)
  return { enabled: input.enabled }
}
