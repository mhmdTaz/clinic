import { processSingleton } from '@clinic/config'

/**
 * "Is this patient one of mine?" — the one authorisation question whose answer lives in clinical
 * data rather than in a grant (ADR-0004, Phase 4 addendum).
 *
 * `ASSIGNED` on an encounter is strict and needs nothing from here: the row names its doctor. A
 * patient row names no doctor, and a chart nobody can open would make the doctor portal useless,
 * so a patient is reachable when the doctor is named on one of that patient's visits. Being able
 * to open the patient is not the same as being able to read a colleague's notes about them —
 * those stay strict, per row, which is exactly what ADR-0004 rejected chart-wide scope to protect.
 *
 * The question is declared here, where authorisation is decided, and answered by the module that
 * owns visits. The composition root wires the two together; until it does, the answer is no.
 */
export interface CareRelationship {
  hasTreated(clinicId: string, doctorId: string, patientId: string): Promise<boolean>
}

const DENIES: CareRelationship = { hasTreated: () => Promise.resolve(false) }

const installed = processSingleton('access:care-relationship', () => ({ answers: DENIES }))

export function provideCareRelationship(answers: CareRelationship): void {
  installed.answers = answers
}

export function careRelationship(): CareRelationship {
  return installed.answers
}
