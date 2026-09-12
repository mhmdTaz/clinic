import { describe, expect, it } from 'vitest'
import { weekdayOf } from '../../scheduling'
import { isOff, rate, rosteredMinutes, utilisationPercent } from '../domain/utilisation'

// 2026-09-14 is a Monday, so the week below runs Mon–Sun.
const WEEK = [
  '2026-09-14',
  '2026-09-15',
  '2026-09-16',
  '2026-09-17',
  '2026-09-18',
  '2026-09-19',
  '2026-09-20',
]

const MORNINGS = [
  { dayOfWeek: 1, startsAt: '09:00', endsAt: '13:00' }, // Monday, 240 minutes
  { dayOfWeek: 3, startsAt: '09:00', endsAt: '13:00' }, // Wednesday, 240 minutes
]

describe('rosteredMinutes', () => {
  it('adds up the blocks that fall on the dates given', () => {
    expect(rosteredMinutes(WEEK, weekdayOf, MORNINGS)).toBe(480)
  })

  it('counts two blocks on the same day', () => {
    const split = [
      { dayOfWeek: 1, startsAt: '09:00', endsAt: '12:00' },
      { dayOfWeek: 1, startsAt: '14:00', endsAt: '17:30' },
    ]
    expect(rosteredMinutes(['2026-09-14'], weekdayOf, split)).toBe(180 + 210)
  })

  it('drops a day the doctor is off', () => {
    const off = [{ startDate: '2026-09-14', endDate: '2026-09-14' }]
    expect(rosteredMinutes(WEEK, weekdayOf, MORNINGS, off)).toBe(240)
  })

  it('treats a time-off range as inclusive on both ends', () => {
    // "Off the 14th to the 16th" means back on the 17th, not on the 16th.
    const off = [{ startDate: '2026-09-14', endDate: '2026-09-16' }]
    expect(rosteredMinutes(WEEK, weekdayOf, MORNINGS, off)).toBe(0)
    expect(isOff('2026-09-16', off)).toBe(true)
    expect(isOff('2026-09-17', off)).toBe(false)
  })

  it('drops a day the clinic is shut, however the doctor is rostered', () => {
    expect(rosteredMinutes(WEEK, weekdayOf, MORNINGS, [], ['2026-09-16'])).toBe(240)
  })

  it('does not double-count a holiday that is also time off', () => {
    const off = [{ startDate: '2026-09-14', endDate: '2026-09-14' }]
    expect(rosteredMinutes(WEEK, weekdayOf, MORNINGS, off, ['2026-09-14'])).toBe(240)
  })

  it('ignores a block that ends before it starts rather than subtracting time', () => {
    const backwards = [{ dayOfWeek: 1, startsAt: '17:00', endsAt: '09:00' }]
    expect(rosteredMinutes(WEEK, weekdayOf, [...MORNINGS, ...backwards])).toBe(480)
  })

  it('is zero when nothing is rostered', () => {
    expect(rosteredMinutes(WEEK, weekdayOf, [])).toBe(0)
    expect(rosteredMinutes([], weekdayOf, MORNINGS)).toBe(0)
  })
})

describe('utilisationPercent', () => {
  it('is booked over rostered, to one decimal place', () => {
    expect(utilisationPercent(240, 480)).toBe(50)
    expect(utilisationPercent(100, 300)).toBe(33.3)
  })

  it('is null when nothing was rostered, not zero', () => {
    // "Not scheduled to work" and "scheduled and idle" are different findings, and a dashboard
    // that shows the first as 0% invents a problem.
    expect(utilisationPercent(0, 0)).toBeNull()
    expect(utilisationPercent(60, 0)).toBeNull()
  })

  it('is zero when the doctor was rostered and saw nobody — the row worth finding', () => {
    expect(utilisationPercent(0, 480)).toBe(0)
  })

  it('can exceed 100, because a double-booked doctor is real', () => {
    expect(utilisationPercent(600, 480)).toBe(125)
  })
})

describe('rate', () => {
  it('is a percentage to one decimal place', () => {
    expect(rate(1, 3)).toBe(33.3)
    expect(rate(7, 8)).toBe(87.5)
  })

  it('is zero rather than NaN when there is nothing to divide by', () => {
    expect(rate(0, 0)).toBe(0)
  })
})
