import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AppointmentSummary } from '@clinic/contracts'
import {
  ageLabel,
  ageOn,
  appointmentStatusLabel,
  fileCategoryLabel,
  formatBytes,
  formatCalendarDate,
  formatWhen,
  isCancellable,
  isOwnBooking,
  nextUpcoming,
  pastAppointments,
  relativeDay,
  shiftDate,
  TICKET_CATEGORY_LABELS,
  ticketStatusLabel,
  upcomingAppointments,
} from '../format'

const appointment = (over: Partial<AppointmentSummary> = {}): AppointmentSummary =>
  ({
    id: 'a1',
    number: 'APT-000001',
    status: 'SCHEDULED',
    source: 'PATIENT',
    startsAt: '2026-09-20T09:00:00.000Z',
    endsAt: '2026-09-20T09:30:00.000Z',
    durationMinutes: 30,
    reason: null,
    patient: { id: 'p1', name: 'Sara Karam', medicalRecordNo: 'MRN-000001', phone: null },
    doctor: { id: 'd1', name: 'Dr Nabil Saad' },
    branchId: null,
    ...over,
  }) as AppointmentSummary

const NOW = new Date('2026-09-19T10:00:00.000Z')

describe('when an appointment is', () => {
  /**
   * The bug this exists to prevent: telling a travelling patient the time on *their* phone rather
   * than the time at the clinic door.
   */
  it('is shown in the clinic’s timezone, not the device’s', () => {
    expect(formatWhen('2026-09-20T06:00:00.000Z', 'UTC')).toContain('06:00')
    // Beirut is UTC+3 in September: the same instant, three hours later on the wall.
    expect(formatWhen('2026-09-20T06:00:00.000Z', 'Asia/Beirut')).toContain('09:00')
  })

  it('renders an unparseable timestamp as a dash rather than "Invalid Date"', () => {
    expect(formatWhen('not a date', 'UTC')).toBe('—')
  })

  it('says today, tomorrow, or how many days', () => {
    expect(relativeDay('2026-09-19T15:00:00.000Z', 'UTC', NOW)).toBe('today')
    expect(relativeDay('2026-09-20T09:00:00.000Z', 'UTC', NOW)).toBe('tomorrow')
    expect(relativeDay('2026-09-24T09:00:00.000Z', 'UTC', NOW)).toBe('in 5 days')
    expect(relativeDay('2026-09-01T09:00:00.000Z', 'UTC', NOW)).toBe('')
  })

  /**
   * The first version rounded a gap in hours: at ten at night, eight o'clock the morning after
   * tomorrow is 34 hours away, which rounded to "in 1 days".
   */
  it('counts calendar days at the clinic, not 24-hour periods', () => {
    const lateEvening = new Date('2026-09-19T22:00:00.000Z')
    expect(relativeDay('2026-09-21T08:00:00.000Z', 'UTC', lateEvening)).toBe('in 2 days')
    expect(relativeDay('2026-09-20T07:00:00.000Z', 'UTC', lateEvening)).toBe('tomorrow')
  })

  it('decides "today" by the clinic’s calendar, not UTC’s', () => {
    // 22:30 UTC on the 19th is already 01:30 on the 20th in Beirut.
    const now = new Date('2026-09-19T22:30:00.000Z')
    expect(relativeDay('2026-09-20T05:00:00.000Z', 'Asia/Beirut', now)).toBe('today')
    expect(relativeDay('2026-09-20T05:00:00.000Z', 'UTC', now)).toBe('tomorrow')
  })
})

describe('calendar dates', () => {
  it('shows the day it is, whatever zone the formatter runs in', () => {
    // Formatting midnight in a local zone is how "21 September" becomes "20".
    // The day and the weekday are the claim; punctuation is the engine's (Node's ICU writes a comma,
    // and Hermes on a device need not).
    expect(formatCalendarDate('2026-09-21')).toMatch(/^Monday,? 21 September 2026$/)
    expect(formatCalendarDate('2026-09-21', 'short')).toMatch(/^Mon,? 21 Sept?$/)
    expect(formatCalendarDate('1991-03-14', 'plain')).toBe('14 March 1991')
    expect(formatCalendarDate('21/09/2026')).toBe('—')
  })

  it('moves by whole days across month and year ends', () => {
    expect(shiftDate('2026-09-30', 1)).toBe('2026-10-01')
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
    // Across a daylight-saving change, which a local-time Date would get wrong.
    expect(shiftDate('2026-10-24', 7)).toBe('2026-10-31')
  })

  it('gives an age in whole years, counting birthdays properly', () => {
    expect(ageOn('1990-09-20', '2026-09-19')).toBe(35)
    expect(ageOn('1990-09-19', '2026-09-19')).toBe(36)
    // Born on 29 February: not yet 36 on 28 February, 36 on 1 March.
    expect(ageOn('1990-02-29', '2026-02-28')).toBe(35)
    expect(ageOn('1990-02-29', '2026-03-01')).toBe(36)
    expect(ageOn('2030-01-01', '2026-09-19')).toBeNull()
  })
})

describe('how old a read is', () => {
  const at = 1_000_000_000_000
  it('reads naturally, singular and plural', () => {
    expect(ageLabel(at, at + 20_000)).toBe('just now')
    expect(ageLabel(at, at + 60_000)).toBe('1 minute ago')
    expect(ageLabel(at, at + 5 * 60_000)).toBe('5 minutes ago')
    expect(ageLabel(at, at + 60 * 60_000)).toBe('1 hour ago')
    expect(ageLabel(at, at + 26 * 60 * 60_000)).toBe('1 day ago')
  })

  it('does not say "-3 minutes ago" when the clock has moved', () => {
    expect(ageLabel(at, at - 3 * 60_000)).toBe('just now')
  })
})

describe('sizes', () => {
  it('uses the units a person recognises', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB')
    expect(formatBytes(Number.NaN)).toBe('—')
  })
})

describe('which appointment is next', () => {
  it('is the soonest one that has not happened, whatever order the API sent', () => {
    const list = [
      appointment({ id: 'c', startsAt: '2026-09-30T09:00:00.000Z' }),
      appointment({ id: 'a', startsAt: '2026-09-20T09:00:00.000Z' }),
      appointment({ id: 'b', startsAt: '2026-09-25T09:00:00.000Z' }),
    ]
    expect(upcomingAppointments(list, NOW).map((one) => one.id)).toEqual(['a', 'b', 'c'])
    expect(nextUpcoming(list, NOW)?.id).toBe('a')
  })

  it('ignores cancelled and missed slots, which hold no place in the day', () => {
    const list = [
      appointment({ id: 'cancelled', status: 'CANCELLED', startsAt: '2026-09-20T09:00:00.000Z' }),
      appointment({ id: 'noshow', status: 'NO_SHOW', startsAt: '2026-09-21T09:00:00.000Z' }),
      appointment({ id: 'real', startsAt: '2026-09-22T09:00:00.000Z' }),
    ]
    expect(nextUpcoming(list, NOW)?.id).toBe('real')
  })

  it('still counts one starting this very second', () => {
    expect(nextUpcoming([appointment({ id: 'now', startsAt: NOW.toISOString() })], NOW)?.id).toBe(
      'now',
    )
  })

  it('is null when there is nothing ahead', () => {
    expect(nextUpcoming([appointment({ startsAt: '2026-01-01T09:00:00.000Z' })], NOW)).toBeNull()
    expect(nextUpcoming([], NOW)).toBeNull()
  })

  it('puts the past and the cancelled newest-first', () => {
    const list = [
      appointment({ id: 'old', startsAt: '2026-08-01T09:00:00.000Z' }),
      appointment({ id: 'recent', startsAt: '2026-09-18T09:00:00.000Z' }),
      appointment({ id: 'cancelled', status: 'CANCELLED', startsAt: '2026-09-30T09:00:00.000Z' }),
    ]
    expect(pastAppointments(list, NOW).map((one) => one.id)).toEqual(['cancelled', 'recent', 'old'])
  })

  it('offers cancelling only for something still ahead', () => {
    expect(isCancellable(appointment({ startsAt: '2026-09-25T09:00:00.000Z' }), NOW)).toBe(true)
    expect(isCancellable(appointment({ startsAt: '2026-09-01T09:00:00.000Z' }), NOW)).toBe(false)
    expect(isCancellable(appointment({ status: 'COMPLETED' }), NOW)).toBe(false)
  })
})

describe('a booking refused as taken', () => {
  /**
   * The server does not yet honour idempotency keys on bookings, so a retry of a booking that went
   * through is refused SLOT_TAKEN. Telling the patient somebody else took their own appointment
   * would have them book a second one.
   */
  it('is recognised as the person’s own when their diary has it', () => {
    const mine = appointment({ id: 'mine', startsAt: '2026-09-22T09:00:00.000Z' })
    expect(isOwnBooking([mine], { doctorId: 'd1', startsAt: '2026-09-22T09:00:00Z' })?.id).toBe(
      'mine',
    )
  })

  it('is somebody else’s when the diary has a different doctor, time, or a cancellation', () => {
    const attempt = { doctorId: 'd1', startsAt: '2026-09-22T09:00:00.000Z' }
    expect(
      isOwnBooking(
        [appointment({ startsAt: attempt.startsAt, doctor: { id: 'd2', name: 'Dr X' } })],
        attempt,
      ),
    ).toBeNull()
    expect(
      isOwnBooking([appointment({ startsAt: '2026-09-22T09:30:00.000Z' })], attempt),
    ).toBeNull()
    expect(
      isOwnBooking([appointment({ startsAt: attempt.startsAt, status: 'CANCELLED' })], attempt),
    ).toBeNull()
  })
})

/**
 * "Word for word" is a claim, so it is checked. A patient who reads "Waiting on you" in an email and
 * "Waiting for you" in the app has been given two statuses.
 */
describe('labels', () => {
  const catalogue = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../../../web/messages/en.json'), 'utf8'),
  ) as {
    scheduling: { statuses: Record<string, string> }
    clinical: { files: { categories: Record<string, string> } }
    support: { statuses: Record<string, string>; categories: Record<string, string> }
  }

  it('match the web’s English catalogue', () => {
    for (const [status, label] of Object.entries(catalogue.scheduling.statuses)) {
      expect(appointmentStatusLabel(status as AppointmentSummary['status'])).toBe(label)
    }
    for (const [category, label] of Object.entries(catalogue.clinical.files.categories)) {
      expect(fileCategoryLabel(category as never)).toBe(label)
    }
    for (const [status, label] of Object.entries(catalogue.support.statuses)) {
      expect(ticketStatusLabel(status as never)).toBe(label)
    }
    expect(TICKET_CATEGORY_LABELS).toEqual(catalogue.support.categories)
  })
})
