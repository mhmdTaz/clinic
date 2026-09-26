import {
  localDateIn,
  type AddToothRecordRequest,
  type ApplyQuickPickRequest,
  type CompleteToothRecordRequest,
  type PersonRef,
  type ToothRecord,
  type ToothRecordListQuery,
  type VoidToothRecordRequest,
} from '@clinic/contracts'
import type { ToothRecordStatus, ToothSurface } from '@clinic/config'
import { ConflictError, NotFoundError, ValidationError } from '../../../errors'
import { pageLimit, type Page } from '../../../pagination'
import { runInTransaction } from '../../../transaction'
import type { Actor } from '../../access'
import { findEncounterOwner } from '../../clinical'
import { getClinicSessionInfo } from '../../clinic'
import { findDoctorForBilling } from '../../doctors'
import type { PatientDentalFacts } from '../../patients'
import { chartingProblems, statusProblem, type ChartingProblem } from '../domain/rules'
import { catalogueRepository, type StoredTreatment } from '../infrastructure/catalogue.repository'
import {
  toothRecordRepository,
  type NewToothRecord,
  type StoredToothRecord,
} from '../infrastructure/tooth-record.repository'
import { syncPlansFor } from './plans'
import { patientForChart } from './scope'

/**
 * Writing the tooth chart (Phase 11, ADR-0035).
 *
 * Every write here adds a row. Nothing is edited: a finished plan gets a COMPLETED row that points
 * at it, and a mistake is voided with a reason. That is what lets the chart be trusted as a
 * record of what happened to a tooth, and replayed as it stood on any day.
 */

const iso = (date: Date | null) => (date ? date.toISOString() : null)

export function toToothRecord(
  record: StoredToothRecord,
  completedByRecordId: string | null = null,
): ToothRecord {
  return {
    id: record.id,
    patientId: record.patientId,
    encounterId: record.encounterId,
    teeth: record.teeth.map((tooth) => ({ fdi: tooth.fdi, role: tooth.role })),
    surfaces: [...record.surfaces],
    treatment: { id: record.treatmentId, ...record.treatment },
    status: record.status,
    completesRecordId: record.completesRecordId,
    completedByRecordId,
    notes: record.notes,
    performedOn: record.performedOn,
    doctor: record.doctor,
    recordedBy: record.recordedBy,
    createdAt: iso(record.createdAt),
    voided: record.voidedAt
      ? { at: record.voidedAt.toISOString(), by: record.voidedBy, reason: record.voidReason ?? '' }
      : null,
  }
}

const refuse = (problems: ChartingProblem[]): never => {
  throw new ValidationError('This cannot be charted as it is.', problems)
}

const personOf = (actor: Actor): PersonRef => ({ id: actor.userId, name: actor.displayName })

interface WhoAndWhen {
  encounterId: string | null
  performedOn: string
  doctorId: string | null
  doctor: PersonRef | null
}

/**
 * The visit, the day and the dentist a row is about. The visit must be this patient's; the day
 * defaults to today in the clinic's zone and cannot be in the future; the dentist defaults to the
 * visit's, then to the caller if they are one. Work that was EXISTING — done before the patient
 * came — has no dentist of ours.
 */
async function resolveWhoAndWhen(
  actor: Actor,
  patient: PatientDentalFacts,
  input: { encounterId: string | null; performedOn: string | null; doctorId: string | null },
  status: ToothRecordStatus,
  now: Date,
): Promise<WhoAndWhen> {
  const clinic = await getClinicSessionInfo(actor.clinicId)
  const today = localDateIn(clinic.timezone, now)
  const performedOn = input.performedOn ?? today
  if (performedOn > today) refuse([{ field: 'performedOn', issue: 'IN_THE_FUTURE' }])

  let visitDoctorId: string | null = null
  if (input.encounterId) {
    const visit = await findEncounterOwner(actor.clinicId, input.encounterId)
    if (!visit || visit.patientId !== patient.id) {
      refuse([{ field: 'encounterId', issue: 'NOT_THIS_PATIENTS_VISIT' }])
    }
    visitDoctorId = visit!.doctorId
  }

  if (status === 'EXISTING') {
    return { encounterId: input.encounterId, performedOn, doctorId: null, doctor: null }
  }
  const doctorId = input.doctorId ?? visitDoctorId ?? actor.doctorId ?? null
  if (!doctorId)
    return { encounterId: input.encounterId, performedOn, doctorId: null, doctor: null }
  const doctor = await findDoctorForBilling(actor.clinicId, doctorId)
  if (!doctor) refuse([{ field: 'doctorId', issue: 'NOT_FOUND' }])
  return {
    encounterId: input.encounterId,
    performedOn,
    doctorId,
    doctor: { id: doctor!.id, name: doctor!.name },
  }
}

function checkRow(
  patient: PatientDentalFacts,
  treatment: StoredTreatment,
  row: {
    teeth: ReadonlyArray<{ fdi: string; role: NewToothRecord['teeth'][number]['role'] }>
    surfaces: readonly ToothSurface[]
    status: ToothRecordStatus
  },
): ChartingProblem[] {
  const problems = chartingProblems({
    teeth: row.teeth,
    surfaces: row.surfaces,
    scope: treatment.scope,
    dentition: patient.dentition,
  })
  const status = statusProblem(treatment.symbol, row.status)
  return status ? [...problems, status] : problems
}

async function activeTreatment(clinicId: string, treatmentId: string): Promise<StoredTreatment> {
  const treatment = await catalogueRepository.findTreatment(clinicId, treatmentId)
  if (!treatment) refuse([{ field: 'treatmentId', issue: 'NOT_FOUND' }])
  if (!treatment!.isActive) refuse([{ field: 'treatmentId', issue: 'RETIRED' }])
  return treatment!
}

const snapshot = (treatment: StoredTreatment) => ({
  code: treatment.code,
  name: treatment.name,
  symbol: treatment.symbol,
  scope: treatment.scope,
})

export async function listToothRecords(
  actor: Actor,
  patientId: string,
  query: ToothRecordListQuery,
): Promise<Page<ToothRecord>> {
  const patient = await patientForChart(actor, patientId, 'dental:read')
  const page = await toothRecordRepository.list(
    actor.clinicId,
    {
      patientId: patient.id,
      tooth: query.tooth,
      status: query.status,
      doctorId: query.doctorId,
      encounterId: query.encounterId,
      from: query.from,
      to: query.to,
      includeVoided: query.includeVoided,
    },
    { cursor: query.cursor, limit: pageLimit(query.limit) },
  )
  const planned = page.items.filter((record) => record.status === 'PLANNED').map((r) => r.id)
  const completions = await toothRecordRepository.completionsOf(actor.clinicId, planned)
  return {
    items: page.items.map((record) => toToothRecord(record, completions.get(record.id) ?? null)),
    nextCursor: page.nextCursor,
  }
}

export async function addToothRecord(
  actor: Actor,
  patientId: string,
  input: AddToothRecordRequest,
  now: Date = new Date(),
): Promise<ToothRecord> {
  const patient = await patientForChart(actor, patientId, 'dental:write')
  const treatment = await activeTreatment(actor.clinicId, input.treatmentId)
  const problems = checkRow(patient, treatment, input)
  if (problems.length > 0) refuse(problems)

  const who = await resolveWhoAndWhen(actor, patient, input, input.status, now)
  const record = await toothRecordRepository.create({
    clinicId: actor.clinicId,
    patientId: patient.id,
    encounterId: who.encounterId,
    teeth: input.teeth.map((tooth) => ({ fdi: tooth.fdi, role: tooth.role ?? null })),
    surfaces: [...input.surfaces],
    treatmentId: treatment.id,
    treatment: snapshot(treatment),
    status: input.status,
    completesRecordId: null,
    notes: input.notes,
    performedOn: who.performedOn,
    doctorId: who.doctorId,
    doctor: who.doctor,
    recordedBy: personOf(actor),
  })
  return toToothRecord(record)
}

/**
 * Carrying out planned work. The plan is not changed; a COMPLETED row with the same teeth,
 * surfaces and treatment is added and points back at it. Refused when the plan is gone, was
 * never a plan, or has already been carried out.
 */
export async function completeToothRecord(
  actor: Actor,
  recordId: string,
  input: CompleteToothRecordRequest,
  now: Date = new Date(),
): Promise<ToothRecord> {
  const facts = await toothRecordRepository.findAccessFacts(actor.clinicId, recordId)
  if (!facts) throw new NotFoundError('Tooth record')
  const patient = await patientForChart(actor, facts.patientId, 'dental:write')

  const planned = await toothRecordRepository.findById(actor.clinicId, recordId)
  if (!planned) throw new NotFoundError('Tooth record')
  if (planned.voidedAt) throw new ConflictError('RECORD_VOIDED', 'This record has been voided.')
  if (planned.status !== 'PLANNED') {
    throw new ConflictError('NOT_PLANNED', 'Only planned work can be marked as done.')
  }
  const done = await toothRecordRepository.completionsOf(actor.clinicId, [planned.id])
  if (done.has(planned.id)) {
    throw new ConflictError('ALREADY_COMPLETED', 'This planned work has already been done.')
  }

  const who = await resolveWhoAndWhen(actor, patient, input, 'COMPLETED', now)
  if (who.performedOn < planned.performedOn) {
    refuse([{ field: 'performedOn', issue: 'BEFORE_THE_PLAN' }])
  }
  const record = await toothRecordRepository.create({
    clinicId: actor.clinicId,
    patientId: patient.id,
    encounterId: who.encounterId,
    teeth: planned.teeth,
    surfaces: planned.surfaces,
    treatmentId: planned.treatmentId,
    treatment: planned.treatment,
    status: 'COMPLETED',
    completesRecordId: planned.id,
    notes: input.notes,
    performedOn: who.performedOn,
    doctorId: who.doctorId,
    doctor: who.doctor,
    recordedBy: personOf(actor),
  })
  // A plan with this work in it now has one item done, and may be finished.
  await syncPlansFor(actor.clinicId, planned.id)
  return toToothRecord(record)
}

/** A mistake is voided, never deleted: the row stays, with who voided it, when and why. */
export async function voidToothRecord(
  actor: Actor,
  recordId: string,
  input: VoidToothRecordRequest,
  now: Date = new Date(),
): Promise<ToothRecord> {
  const facts = await toothRecordRepository.findAccessFacts(actor.clinicId, recordId)
  if (!facts) throw new NotFoundError('Tooth record')
  await patientForChart(actor, facts.patientId, 'dental:write')

  const voided = await toothRecordRepository.void(actor.clinicId, recordId, {
    by: personOf(actor),
    reason: input.reason,
    at: now,
  })
  if (!voided) throw new ConflictError('RECORD_VOIDED', 'This record has already been voided.')
  // Voiding planned work drops it from any plan; voiding a completion reopens the planned item.
  const planned = voided.status === 'PLANNED' ? voided.id : voided.completesRecordId
  if (planned) await syncPlansFor(actor.clinicId, planned)
  return toToothRecord(voided)
}

/**
 * One tap, several rows: "Root canal and crown" on 16. Every row is checked before any is
 * written, and they are written together, so a preset never lands half-applied.
 */
export async function applyQuickPick(
  actor: Actor,
  patientId: string,
  quickPickId: string,
  input: ApplyQuickPickRequest,
  now: Date = new Date(),
): Promise<ToothRecord[]> {
  const patient = await patientForChart(actor, patientId, 'dental:write')
  const pick = await catalogueRepository.findQuickPick(actor.clinicId, quickPickId)
  if (!pick || (pick.doctorId && pick.doctorId !== actor.doctorId)) {
    throw new NotFoundError('Quick-pick')
  }
  if (!pick.isActive) refuse([{ field: 'quickPickId', issue: 'RETIRED' }])

  const treatments = await catalogueRepository.findTreatments(
    actor.clinicId,
    pick.items.map((item) => item.treatmentId),
  )
  const teeth = input.teeth.map((tooth) => ({ fdi: tooth.fdi, role: tooth.role ?? null }))
  const problems: ChartingProblem[] = []
  for (const item of pick.items) {
    const treatment = treatments.get(item.treatmentId)
    if (!treatment || !treatment.isActive) {
      problems.push({ field: 'quickPickId', issue: 'TREATMENT_UNAVAILABLE' })
      continue
    }
    problems.push(
      ...checkRow(patient, treatment, { teeth, surfaces: item.surfaces, status: item.status }),
    )
  }
  if (problems.length > 0) refuse(problems)

  // Every row of one preset shares the visit, the day and the dentist.
  const firstStatus = pick.items[0]!.status
  const who = await resolveWhoAndWhen(actor, patient, input, firstStatus, now)
  const rows: NewToothRecord[] = pick.items.map((item) => {
    const treatment = treatments.get(item.treatmentId)!
    const existing = item.status === 'EXISTING'
    return {
      clinicId: actor.clinicId,
      patientId: patient.id,
      encounterId: who.encounterId,
      teeth,
      surfaces: [...item.surfaces],
      treatmentId: treatment.id,
      treatment: snapshot(treatment),
      status: item.status,
      completesRecordId: null,
      notes: input.notes,
      performedOn: who.performedOn,
      doctorId: existing ? null : who.doctorId,
      doctor: existing ? null : who.doctor,
      recordedBy: personOf(actor),
    }
  })
  const created = await runInTransaction((tx) => toothRecordRepository.createMany(rows, tx))
  return created.map((record) => toToothRecord(record))
}
