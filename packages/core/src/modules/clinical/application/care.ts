import type { PatientSummary } from '@clinic/contracts'
import { assertCan, type Actor, type CareRelationship } from '../../access'
import { listPatientsByIds } from '../../patients'
import { pageLimit, type Page } from '../../../pagination'
import { encounterRepository } from '../infrastructure/encounter.repository'

/**
 * The answer to the access module's one clinical question (ADR-0004, Phase 4 addendum): is this
 * patient one of mine?
 *
 * A doctor is named on the visits they conducted, so a patient they have seen is a patient they
 * may open. The chart's *contents* stay strict per row — a colleague's note on the same patient
 * is still out of reach — which is the distinction ADR-0004 rejected chart-wide scope to keep.
 */
export const careRelationshipFromEncounters: CareRelationship = {
  hasTreated(clinicId, doctorId, patientId) {
    return encounterRepository.hasTreated(clinicId, doctorId, patientId)
  },
}

/** How many patients "my patients" reaches back over. A clinic's doctor, not a hospital's. */

/** The ids behind D3, newest visit first; the patients module turns them into records. */
export function patientIdsTreatedBy(
  clinicId: string,
  doctorId: string,
  page: { cursor?: string; limit: number },
): Promise<Page<string>> {
  return encounterRepository.patientIdsTreatedBy(clinicId, doctorId, page)
}

/**
 * Who a visit belongs to, with no permission check and no PHI read: what another module needs
 * in order to decide whether its own caller may act — a file being attached to this encounter,
 * a prescription being written against it.
 */
export async function findEncounterOwner(
  clinicId: string,
  encounterId: string,
): Promise<{ id: string; patientId: string; doctorId: string; status: string } | null> {
  const facts = await encounterRepository.findAccessFacts(clinicId, encounterId)
  return facts
    ? { id: facts.id, patientId: facts.patientId, doctorId: facts.doctorId, status: facts.status }
    : null
}

/**
 * "My patients" (D3): every patient this doctor has treated, newest visit first.
 *
 * It is a query over visits rather than a filter on the directory, because that is what the
 * question actually is. A doctor holding `patient:read` at ASSIGNED is refused the clinic's
 * directory and given this instead — the same rule, asked the right way round.
 */
export async function listMyPatients(
  actor: Actor,
  query: { cursor?: string; limit?: number } = {},
): Promise<Page<PatientSummary>> {
  await assertCan(actor, 'patient:read')
  if (!actor.doctorId) return { items: [], nextCursor: null }
  const ids = await patientIdsTreatedBy(actor.clinicId, actor.doctorId, {
    cursor: query.cursor,
    limit: pageLimit(query.limit),
  })
  return { items: await listPatientsByIds(actor, ids.items), nextCursor: ids.nextCursor }
}
