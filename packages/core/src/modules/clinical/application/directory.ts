import type { EncounterDetail, EncounterListQuery, EncounterSummary } from '@clinic/contracts'
import { NotFoundError } from '../../../errors'
import { pageLimit, type Page } from '../../../pagination'
import { assertCan, type Actor } from '../../access'
import { getClinicFacts } from '../../clinic'
import { instantOf, nextDate } from '../../scheduling'
import { encounterRepository, type StoredEncounter } from '../infrastructure/encounter.repository'
import { encounterListScope, encounterResource, readsWholeClinic } from './scope'

const iso = (date: Date | null) => (date ? date.toISOString() : null)

export function toEncounterSummary(encounter: StoredEncounter): EncounterSummary {
  return {
    id: encounter.id,
    number: encounter.number,
    status: encounter.status,
    encounterType: encounter.encounterType,
    chiefComplaint: encounter.chiefComplaint,
    startedAt: encounter.startedAt.toISOString(),
    endedAt: iso(encounter.endedAt),
    patient: {
      id: encounter.patientId,
      name: encounter.patient.name,
      medicalRecordNo: encounter.patient.medicalRecordNo,
    },
    doctor: { id: encounter.doctorId, name: encounter.doctor.name },
    appointmentId: encounter.appointmentId,
    noteStatus: encounter.note.status,
    diagnoses: encounter.diagnoses,
  }
}

/**
 * `includeNote` is decided by the caller from the access facts, before the content is fetched.
 * When it is false the note's text was never read out of the database at all (section 7.5), and
 * what is returned here is the shape of a note with nothing in it.
 */
export function toEncounterDetail(
  encounter: StoredEncounter,
  options: { includeNote: boolean },
): EncounterDetail {
  return {
    ...toEncounterSummary(encounter),
    note: {
      subjective: options.includeNote ? encounter.note.subjective : null,
      objective: options.includeNote ? encounter.note.objective : null,
      assessment: options.includeNote ? encounter.note.assessment : null,
      plan: options.includeNote ? encounter.note.plan : null,
      status: encounter.note.status,
      isPatientVisible: encounter.note.isPatientVisible,
      signedAt: iso(encounter.note.signedAt),
      signedBy: encounter.note.signedBy,
      addenda: options.includeNote
        ? encounter.note.addenda.map((entry) => ({
            id: entry.id,
            body: entry.body,
            author: entry.author,
            createdAt: iso(entry.createdAt),
          }))
        : [],
    },
    vitals: encounter.vitals
      ? { ...encounter.vitals, recordedAt: iso(encounter.vitals.recordedAt) }
      : null,
    createdBy: encounter.createdBy,
  }
}

/**
 * Whether this actor may read what the note actually says.
 *
 * The clinic and the doctor who wrote it always may. A patient may read their own note only
 * once it has been signed AND flagged as shared: an unfinished thought is not a document, and
 * sharing is a decision someone takes rather than a default (ADR-0025).
 */
export function mayReadNote(
  actor: Actor,
  facts: { doctorId: string; noteStatus: string; isNoteVisible: boolean },
): boolean {
  if (readsWholeClinic(actor)) return true
  if (actor.doctorId && actor.doctorId === facts.doctorId) return true
  return facts.noteStatus === 'SIGNED' && facts.isNoteVisible
}

/** The chart timeline and the doctor's list of visits (D4, D5, P4, P10), a page at a time. */
export async function listEncounters(
  actor: Actor,
  query: Partial<EncounterListQuery>,
): Promise<Page<EncounterSummary>> {
  const scope = await encounterListScope(actor)
  const clinic = await getClinicFacts(actor.clinicId)

  const page = await encounterRepository.list(
    actor.clinicId,
    {
      patientId: scope.patientId ?? query.patientId,
      doctorId: scope.doctorId ?? query.doctorId,
      appointmentIds: query.appointmentIds,
      status: query.status,
      from: query.from ? instantOf(query.from, '00:00', clinic.timezone) : undefined,
      to: query.to ? instantOf(nextDate(query.to), '00:00', clinic.timezone) : undefined,
    },
    { cursor: query.cursor, limit: pageLimit(query.limit) },
    // A timeline lists visits, never note text — so the text is not read for any audience.
    { omitNoteContent: true },
  )
  return { items: page.items.map(toEncounterSummary), nextCursor: page.nextCursor }
}

export async function getEncounter(actor: Actor, encounterId: string): Promise<EncounterDetail> {
  // The access facts first, and they are not a PHI read: refusing someone must not look, in the
  // audit log, exactly like letting them in (section 11.3).
  const facts = await encounterRepository.findAccessFacts(actor.clinicId, encounterId)
  if (!facts) throw new NotFoundError('Encounter')

  await assertCan(
    actor,
    'encounter:read',
    encounterResource(actor, {
      id: facts.id,
      patientId: facts.patientId,
      doctorId: facts.doctorId,
    }),
  )

  const includeNote = mayReadNote(actor, facts)
  const encounter = await encounterRepository.findById(actor.clinicId, encounterId, {
    omitNoteContent: !includeNote,
  })
  if (!encounter) throw new NotFoundError('Encounter')
  return toEncounterDetail(encounter, { includeNote })
}
