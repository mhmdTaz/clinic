import type { DentalChart, DentalChartQuery, SetDentitionRequest } from '@clinic/contracts'
import { NotFoundError } from '../../../errors'
import type { Actor } from '../../access'
import { setPatientDentition } from '../../patients'
import { deriveChart } from '../domain/derive-chart'
import { toothRecordRepository } from '../infrastructure/tooth-record.repository'
import { patientForChart } from './scope'

/**
 * The picture (Phase 11): every tooth of the patient's dentition, what each one shows, whether it
 * is still in the mouth, the last day anything was charted, and every day that can be replayed.
 *
 * One read of the patient's rows and a pure function over them. Asking for an earlier day is the
 * same read with fewer rows let through, which is why the time slider costs nothing to store.
 */
export async function getDentalChart(
  actor: Actor,
  patientId: string,
  query: DentalChartQuery = {},
): Promise<DentalChart> {
  const patient = await patientForChart(actor, patientId, 'dental:read')
  const records = await toothRecordRepository.listForChart(actor.clinicId, patient.id)
  const derived = deriveChart({
    records: records.map((record) => ({
      id: record.id,
      encounterId: record.encounterId,
      teeth: record.teeth,
      surfaces: record.surfaces,
      symbol: record.treatment.symbol,
      treatmentName: record.treatment.name,
      status: record.status,
      completesRecordId: record.completesRecordId,
      performedOn: record.performedOn,
      createdAt: record.createdAt,
      voided: record.voidedAt !== null,
    })),
    dentition: patient.dentition,
    asOf: query.asOf ?? null,
  })
  return {
    patientId: patient.id,
    dentition: patient.dentition,
    asOf: query.asOf ?? null,
    teeth: derived.teeth,
    lastCharted: derived.lastCharted,
    history: derived.history,
  }
}

/**
 * Which teeth the chart draws. A child's chart moves from PRIMARY to MIXED to PERMANENT as teeth
 * are lost and replaced; the rows already charted are untouched, and a tooth outside the new
 * dentition that has rows is still drawn.
 */
export async function setDentition(
  actor: Actor,
  patientId: string,
  input: SetDentitionRequest,
): Promise<DentalChart> {
  const patient = await patientForChart(actor, patientId, 'dental:write')
  const updated = await setPatientDentition(actor.clinicId, patient.id, input.dentition, {
    id: actor.userId,
    name: actor.displayName,
  })
  if (!updated) throw new NotFoundError('Patient')
  return getDentalChart(actor, patient.id)
}
