import { describe, expect, it } from 'vitest'
import { ApiError } from '@clinic/api-client'
import type {
  Allergy,
  AppointmentSummary,
  ClinicalNote,
  EncounterSummary,
  Vitals,
} from '@clinic/contracts'
import {
  agenda,
  agendaAction,
  allergiesWorstFirst,
  allergyText,
  grantsOf,
  isNoteDirty,
  maySign,
  noteMode,
  noteStateOf,
  noteUpdate,
  rebaseNote,
  vitalsReadings,
} from '../clinical'
import { messageFor, signInMessageFor } from '../errors'

const appointment = (id: string, startsAt: string, status = 'SCHEDULED') =>
  ({ id, startsAt, status, patient: { id: 'p1' } }) as unknown as AppointmentSummary

const visit = (id: string, appointmentId: string | null, noteStatus = 'DRAFT') =>
  ({ id, appointmentId, noteStatus }) as unknown as EncounterSummary

const note = (over: Partial<ClinicalNote> = {}): ClinicalNote => ({
  subjective: 'Sore throat.',
  objective: null,
  assessment: null,
  plan: 'Fluids.',
  status: 'DRAFT',
  isPatientVisible: false,
  signedAt: null,
  signedBy: null,
  addenda: [],
  ...over,
})

const doctorGrants = grantsOf({
  permissions: [
    { key: 'encounter:write', scope: 'ASSIGNED' },
    { key: 'encounter:sign', scope: 'ASSIGNED' },
  ],
  permissionVersion: 1,
})

describe('the day', () => {
  it('runs in time order, each appointment with its own visit', () => {
    const entries = agenda(
      [appointment('late', '2026-09-19T11:00:00Z'), appointment('early', '2026-09-19T08:00:00Z')],
      [visit('v1', 'late'), visit('walk-in', null)],
    )
    expect(entries.map((entry) => [entry.appointment.id, entry.visit?.id ?? null])).toEqual([
      ['early', null],
      ['late', 'v1'],
    ])
  })

  it('offers the note that exists, or to start one, and nothing for a cancellation', () => {
    const options = { visitsKnown: true, canWrite: true }
    const [withVisit] = agenda([appointment('a', '2026-09-19T08:00:00Z')], [visit('v', 'a')])
    const [without] = agenda([appointment('b', '2026-09-19T08:00:00Z')], [])
    const [cancelled] = agenda([appointment('c', '2026-09-19T08:00:00Z', 'CANCELLED')], [])
    expect(agendaAction(withVisit!, options)).toBe('openNote')
    expect(agendaAction(without!, options)).toBe('recordVisit')
    expect(agendaAction(cancelled!, options)).toBe('none')
    expect(agendaAction(without!, { visitsKnown: true, canWrite: false })).toBe('none')
  })

  it('offers neither when it cannot tell which appointments already have a visit', () => {
    // Offline, or the list failed. "Record the visit" on one that has a visit would be refused.
    const [entry] = agenda([appointment('a', '2026-09-19T08:00:00Z')], [])
    expect(agendaAction(entry!, { visitsKnown: false, canWrite: true })).toBe('none')
  })
})

describe('the chart banner', () => {
  const allergy = (
    substance: string,
    severity: Allergy['severity'],
    reaction: string | null = null,
  ) => ({ id: substance, substance, severity, reaction, notedAt: null }) as Allergy

  it('puts the dangerous allergy first', () => {
    const sorted = allergiesWorstFirst([
      allergy('Dust', 'MILD'),
      allergy('Latex', 'UNKNOWN'),
      allergy('Penicillin', 'SEVERE'),
      allergy('Nuts', 'MODERATE'),
    ])
    expect(sorted.map((one) => one.substance)).toEqual(['Penicillin', 'Nuts', 'Dust', 'Latex'])
  })

  it('says the severity in words, not only in colour', () => {
    expect(allergyText(allergy('Penicillin', 'SEVERE', 'hives'))).toBe(
      'Penicillin — hives (severe)',
    )
    expect(allergyText(allergy('Latex', 'UNKNOWN'))).toBe('Latex (severity unknown)')
  })
})

describe('vitals', () => {
  it('shows what was measured, with units, and skips what was not', () => {
    const readings = vitalsReadings({
      heightCm: null,
      weightKg: '72.4',
      temperatureC: '36.6',
      systolicMmHg: 120,
      diastolicMmHg: 80,
      heartRateBpm: null,
      respiratoryRate: null,
      oxygenSaturation: 98,
      bloodGlucose: null,
      recordedAt: null,
      recordedBy: null,
    } as Vitals)
    expect(readings).toEqual([
      { label: 'Weight', value: '72.4 kg' },
      { label: 'Temperature', value: '36.6 °C' },
      { label: 'Systolic', value: '120 mmHg' },
      { label: 'Diastolic', value: '80 mmHg' },
      { label: 'Oxygen saturation', value: '98 %' },
    ])
    expect(vitalsReadings(null)).toEqual([])
  })
})

describe('the note', () => {
  it('sends only the sections changed on this phone', () => {
    const baseline = noteStateOf(note())
    const current = { ...baseline, draft: { ...baseline.draft, assessment: 'Viral pharyngitis.' } }
    expect(noteUpdate(current, baseline)).toEqual({ note: { assessment: 'Viral pharyngitis.' } })
  })

  it('sends an emptied section as cleared, and sharing on its own', () => {
    const baseline = noteStateOf(note())
    const cleared = { ...baseline, draft: { ...baseline.draft, plan: '   ' } }
    expect(noteUpdate(cleared, baseline)).toEqual({ note: { plan: null } })
    expect(noteUpdate({ ...baseline, shared: true }, baseline)).toEqual({
      isNoteVisibleToPatient: true,
    })
    expect(noteUpdate(baseline, baseline)).toBeNull()
  })

  /**
   * The desk saves the plan while the phone is writing the assessment. The refetch must not throw
   * away what was typed, and the phone's save must not put the old plan back.
   */
  it('takes the server’s sections wherever nothing was typed here', () => {
    const baseline = noteStateOf(note())
    const typed = { ...baseline, draft: { ...baseline.draft, assessment: 'Viral.' } }
    const fromDesk = noteStateOf(note({ plan: 'Fluids and rest, review in a week.' }))

    const rebased = rebaseNote(typed, baseline, fromDesk)
    expect(rebased.draft.assessment).toBe('Viral.')
    expect(rebased.draft.plan).toBe('Fluids and rest, review in a week.')
    expect(isNoteDirty(rebased, fromDesk)).toBe(true)
    expect(noteUpdate(rebased, fromDesk)).toEqual({ note: { assessment: 'Viral.' } })
  })

  it('is clean again once the server holds what was typed', () => {
    const baseline = noteStateOf(note())
    const typed = { ...baseline, draft: { ...baseline.draft, objective: 'Red throat.' } }
    const saved = noteStateOf(note({ objective: 'Red throat.' }))
    expect(isNoteDirty(rebaseNote(typed, baseline, saved), saved)).toBe(false)
  })

  it('is written by its own doctor, read by anybody else, and signed only by its own', () => {
    const mine = { doctor: { id: 'd1', name: 'Dr Saad' }, note: note() }
    expect(noteMode(mine, 'd1', doctorGrants)).toBe('write')
    expect(noteMode(mine, 'd2', doctorGrants)).toBe('read')
    expect(noteMode(mine, 'd1', grantsOf(undefined))).toBe('read')
    expect(noteMode({ ...mine, note: note({ status: 'SIGNED' }) }, 'd1', doctorGrants)).toBe(
      'signed',
    )
    expect(maySign(mine, 'd1', doctorGrants)).toBe(true)
    expect(maySign(mine, 'd2', doctorGrants)).toBe(false)
    expect(maySign(mine, null, doctorGrants)).toBe(false)
  })
})

describe('what a failure says', () => {
  it('translates what never reached the server, and keeps the clinic’s own words otherwise', () => {
    expect(messageFor(new ApiError(0, 'NETWORK_UNREACHABLE', 'Network request failed'))).toBe(
      'The clinic could not be reached. Check your connection and try again.',
    )
    expect(
      messageFor(new ApiError(422, 'BEYOND_HORIZON', 'That is further ahead than booking opens.')),
    ).toBe('That is further ahead than booking opens.')
    expect(messageFor(new ApiError(503, 'UNAVAILABLE', 'upstream timeout'))).toBe(
      'Something went wrong at the clinic’s end. Try again shortly.',
    )
    expect(messageFor(new TypeError('x'))).toBe('Something went wrong. Please try again.')
  })

  /** The first sign-in screen checked for a code no endpoint sends. */
  it('counts down a lockout in the server’s own code, in whole minutes', () => {
    const lockout = (seconds: number | null) =>
      new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts.', [], seconds)
    expect(messageFor(lockout(30))).toBe('Too many attempts. Try again in 1 minute.')
    expect(messageFor(lockout(125))).toBe('Too many attempts. Try again in 3 minutes.')
    expect(messageFor(lockout(null))).toBe('Too many attempts. Try again shortly.')
  })

  it('never says whether an email exists', () => {
    expect(
      signInMessageFor(
        new ApiError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.'),
      ),
    ).toBe('That email and password do not match.')
  })
})
