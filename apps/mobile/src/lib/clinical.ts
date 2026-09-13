import type {
  Allergy,
  AllergySeverity,
  AppointmentSummary,
  ChronicCondition,
  ClinicalNote,
  EncounterDetail,
  EncounterSummary,
  MePermissions,
  UpdateEncounterRequest,
  Vitals,
} from '@clinic/contracts'

/**
 * The doctor portal's rules, kept apart from the screens so they can be tested without a device.
 *
 * Most of them are about **what to offer**. The server decides every one of these again — a
 * signed note refuses edits, a colleague's visit refuses a write — and this file only keeps the
 * app from showing a button that will be refused, which on a phone between patients is a wasted
 * tap and a confusing message.
 */

// ── What this person may do ──────────────────────────────────────────────────

export type Grants = ReadonlyMap<string, MePermissions['permissions'][number]['scope']>

export const grantsOf = (permissions: MePermissions | undefined): Grants =>
  new Map((permissions?.permissions ?? []).map((grant) => [grant.key, grant.scope]))

export const holds = (grants: Grants, key: string): boolean => grants.has(key)

// ── The day ──────────────────────────────────────────────────────────────────

export interface AgendaEntry {
  appointment: AppointmentSummary
  /** The visit recorded against this appointment, if there is one. */
  visit: EncounterSummary | null
}

/** Statuses for which there is nobody in the room to write a note about. */
const NO_VISIT = new Set<AppointmentSummary['status']>(['CANCELLED', 'NO_SHOW'])

/**
 * The day in the order it will happen, each appointment with its visit.
 *
 * One list of visits for the day matched by appointment, rather than a request per card — which is
 * also what the web agenda does, and for the same reason.
 */
export function agenda(
  appointments: readonly AppointmentSummary[],
  visits: readonly EncounterSummary[],
): AgendaEntry[] {
  const byAppointment = new Map(
    visits.flatMap((visit) => (visit.appointmentId ? [[visit.appointmentId, visit] as const] : [])),
  )
  return [...appointments]
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
    .map((appointment) => ({ appointment, visit: byAppointment.get(appointment.id) ?? null }))
}

export type AgendaAction = 'openNote' | 'recordVisit' | 'none'

/**
 * What an appointment on the day offers.
 *
 * `visitsKnown` is false when the list of visits could not be loaded — offline, typically, since
 * visits are not kept for offline reading. Then neither action is offered: "record the visit" on an
 * appointment that already has one would only be refused, and hiding "open the note" is honest
 * about not knowing.
 */
export function agendaAction(
  entry: AgendaEntry,
  options: { visitsKnown: boolean; canWrite: boolean },
): AgendaAction {
  if (!options.visitsKnown) return 'none'
  if (entry.visit) return 'openNote'
  if (NO_VISIT.has(entry.appointment.status) || !options.canWrite) return 'none'
  return 'recordVisit'
}

// ── The chart banner ─────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<AllergySeverity, number> = {
  SEVERE: 0,
  MODERATE: 1,
  MILD: 2,
  UNKNOWN: 3,
}

/** Worst first: the one that would kill someone should not be third in a row. */
export const allergiesWorstFirst = (allergies: readonly Allergy[]): Allergy[] =>
  [...allergies].sort(
    (left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity],
  )

export const hasSevereAllergy = (allergies: readonly Allergy[]): boolean =>
  allergies.some((allergy) => allergy.severity === 'SEVERE')

export const activeConditions = (conditions: readonly ChronicCondition[]): ChronicCondition[] =>
  conditions.filter((condition) => !condition.resolvedAt)

const SEVERITY_WORDS: Record<AllergySeverity, string> = {
  SEVERE: 'severe',
  MODERATE: 'moderate',
  MILD: 'mild',
  UNKNOWN: 'severity unknown',
}

/** "Penicillin — hives (severe)". Words as well as colour, never colour alone (§14.5). */
export const allergyText = (allergy: Allergy): string =>
  `${allergy.substance}${allergy.reaction ? ` — ${allergy.reaction}` : ''} (${SEVERITY_WORDS[allergy.severity]})`

// ── Vitals ───────────────────────────────────────────────────────────────────

const VITAL_FIELDS: ReadonlyArray<{ key: keyof Vitals; label: string; unit: string }> = [
  { key: 'heightCm', label: 'Height', unit: 'cm' },
  { key: 'weightKg', label: 'Weight', unit: 'kg' },
  { key: 'temperatureC', label: 'Temperature', unit: '°C' },
  { key: 'systolicMmHg', label: 'Systolic', unit: 'mmHg' },
  { key: 'diastolicMmHg', label: 'Diastolic', unit: 'mmHg' },
  { key: 'heartRateBpm', label: 'Heart rate', unit: 'bpm' },
  { key: 'respiratoryRate', label: 'Respiratory rate', unit: '/min' },
  { key: 'oxygenSaturation', label: 'Oxygen saturation', unit: '%' },
  { key: 'bloodGlucose', label: 'Blood glucose', unit: 'mmol/L' },
]

/**
 * The readings that were taken, in the web's order and units.
 *
 * Only what was recorded. A zero is a reading and is shown; a null is not a reading and is not —
 * "Heart rate: —" on a phone screen reads as though somebody measured nothing.
 */
export function vitalsReadings(vitals: Vitals | null): Array<{ label: string; value: string }> {
  if (!vitals) return []
  return VITAL_FIELDS.flatMap(({ key, label, unit }) => {
    const value = vitals[key]
    if (value === null || value === undefined || value === '') return []
    if (typeof value !== 'string' && typeof value !== 'number') return []
    return [{ label, value: `${value} ${unit}` }]
  })
}

// ── The note ─────────────────────────────────────────────────────────────────

export const NOTE_SECTIONS = ['subjective', 'objective', 'assessment', 'plan'] as const
export type NoteSection = (typeof NOTE_SECTIONS)[number]
export type NoteDraft = Record<NoteSection, string>

export const NOTE_SECTION_TEXT: Record<NoteSection, { label: string; hint: string }> = {
  subjective: { label: 'Subjective', hint: 'What the patient describes.' },
  objective: { label: 'Objective', hint: 'What you found on examination.' },
  assessment: { label: 'Assessment', hint: 'What you think it is.' },
  plan: { label: 'Plan', hint: 'What happens next.' },
}

/** What the editor holds: the four sections as typed, and whether it is shared. */
export interface NoteState {
  draft: NoteDraft
  shared: boolean
}

export const noteStateOf = (note: ClinicalNote): NoteState => ({
  draft: {
    subjective: note.subjective ?? '',
    objective: note.objective ?? '',
    assessment: note.assessment ?? '',
    plan: note.plan ?? '',
  },
  shared: note.isPatientVisible,
})

/**
 * Whether anything typed differs from the note as last loaded or saved.
 *
 * Measured against that **baseline**, not against whatever the server holds this second: a
 * section somebody changed on the desk is not a change made on this phone.
 */
export const isNoteDirty = (current: NoteState, baseline: NoteState): boolean =>
  NOTE_SECTIONS.some((section) => current.draft[section] !== baseline.draft[section]) ||
  current.shared !== baseline.shared

/**
 * The update for what was changed on this phone, and nothing else.
 *
 * **Only the sections edited here are sent.** A note is written in the order a doctor thinks, and
 * the same note can be open on the desk and on a phone. Sending every section would have this save
 * quietly put back whatever the desk had just written. An emptied section is sent as null —
 * cleared — never as an empty string.
 */
export function noteUpdate(current: NoteState, baseline: NoteState): UpdateEncounterRequest | null {
  const changed = NOTE_SECTIONS.filter(
    (section) => current.draft[section] !== baseline.draft[section],
  )
  const sharingChanged = current.shared !== baseline.shared
  if (changed.length === 0 && !sharingChanged) return null

  return {
    ...(changed.length > 0
      ? {
          note: Object.fromEntries(
            changed.map((section) => [
              section,
              current.draft[section].trim() === '' ? null : current.draft[section],
            ]),
          ),
        }
      : {}),
    ...(sharingChanged ? { isNoteVisibleToPatient: current.shared } : {}),
  }
}

/**
 * The note moved on the server while it was open here — a save from the desk, or this phone's own.
 *
 * Every section not edited here takes the server's text; every section edited here keeps what was
 * typed. So a refetch never throws away somebody's words, and a save never reverts a colleague's.
 * (Both editing the same section is still last-save-wins, which is what the web does too.)
 */
export function rebaseNote(current: NoteState, baseline: NoteState, server: NoteState): NoteState {
  return {
    draft: Object.fromEntries(
      NOTE_SECTIONS.map((section) => [
        section,
        current.draft[section] === baseline.draft[section]
          ? server.draft[section]
          : current.draft[section],
      ]),
    ) as NoteDraft,
    shared: current.shared === baseline.shared ? server.shared : current.shared,
  }
}

export const sameNote = (left: NoteState, right: NoteState): boolean => !isNoteDirty(left, right)

export type NoteMode =
  /** The doctor's own draft, and they may write it. */
  | 'write'
  /** Signed: read it, and add beneath it if they may sign. */
  | 'signed'
  /** Somebody else's visit, or no permission to write. */
  | 'read'

export function noteMode(
  encounter: Pick<EncounterDetail, 'doctor' | 'note'>,
  doctorId: string | null,
  grants: Grants,
): NoteMode {
  if (encounter.note.status === 'SIGNED') return 'signed'
  const mine = doctorId !== null && encounter.doctor.id === doctorId
  return mine && holds(grants, 'encounter:write') ? 'write' : 'read'
}

/** Only the doctor whose visit it is signs it, or adds to it once signed (ADR-0024). */
export const maySign = (
  encounter: Pick<EncounterDetail, 'doctor'>,
  doctorId: string | null,
  grants: Grants,
): boolean =>
  doctorId !== null && encounter.doctor.id === doctorId && holds(grants, 'encounter:sign')
