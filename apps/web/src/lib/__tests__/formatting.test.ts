import { describe, expect, it } from 'vitest'
import type { AppointmentSummary } from '@clinic/contracts'
import { activeHref } from '../../components/shell/nav-utils'
import {
  datesBetween,
  formatTimeOfDay,
  isCalendarDate,
  shiftDate,
  startOfWeek,
  weekdayOfDate,
} from '../format/dates'
import { partOfDay } from '../format/greeting'
import { describeUserAgent } from '../format/user-agent'
import { WEEK_ORDER, weekdayName } from '../format/weekdays'
import { groupByDate, groupByDoctor } from '../scheduling/group'

describe('partOfDay', () => {
  const at = (iso: string) => new Date(iso)

  it('uses the clinic timezone, not UTC', () => {
    // 07:30 UTC is 10:30 in Beirut in summer (UTC+3): still morning there.
    expect(partOfDay('Asia/Beirut', at('2026-07-01T07:30:00Z'))).toBe('morning')
    // 10:00 UTC is 13:00 in Beirut: afternoon there, morning in UTC.
    expect(partOfDay('Asia/Beirut', at('2026-07-01T10:00:00Z'))).toBe('afternoon')
    expect(partOfDay('UTC', at('2026-07-01T10:00:00Z'))).toBe('morning')
  })

  it('switches at 12:00 and 18:00 exactly', () => {
    expect(partOfDay('UTC', at('2026-01-01T11:59:59Z'))).toBe('morning')
    expect(partOfDay('UTC', at('2026-01-01T12:00:00Z'))).toBe('afternoon')
    expect(partOfDay('UTC', at('2026-01-01T17:59:59Z'))).toBe('afternoon')
    expect(partOfDay('UTC', at('2026-01-01T18:00:00Z'))).toBe('evening')
  })

  it('falls back to UTC instead of crashing on an unknown timezone', () => {
    expect(partOfDay('Not/AZone', at('2026-01-01T20:00:00Z'))).toBe('evening')
  })
})

describe('weekdays', () => {
  it('maps 0 to Sunday and 6 to Saturday', () => {
    expect(weekdayName(0, 'en')).toBe('Sunday')
    expect(weekdayName(1, 'en')).toBe('Monday')
    expect(weekdayName(6, 'en')).toBe('Saturday')
  })

  it('lists every day once, Monday first', () => {
    expect([...WEEK_ORDER].sort()).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(WEEK_ORDER[0]).toBe(1)
  })
})

describe('describeUserAgent', () => {
  it('tells Edge apart from the Chrome it claims to be', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0',
      ),
    ).toEqual({ browser: 'Edge', os: 'Windows' })
  })

  it('reports an iPhone as iOS, not the macOS its user agent also mentions', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ browser: 'Safari', os: 'iOS' })
  })

  it('reports Android rather than the Linux it runs on', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36',
      ),
    ).toEqual({ browser: 'Chrome', os: 'Android' })
  })

  it('returns null when there is nothing to go on', () => {
    expect(describeUserAgent(null)).toBeNull()
    expect(describeUserAgent('curl/8.5.0')).toBeNull()
  })
})

describe('activeHref', () => {
  const hrefs = ['/admin', '/admin/roles', '/account']

  it('picks the most specific item containing the path', () => {
    expect(activeHref('/admin', hrefs)).toBe('/admin')
    expect(activeHref('/admin/roles', hrefs)).toBe('/admin/roles')
    expect(activeHref('/admin/roles/r1', hrefs)).toBe('/admin/roles')
  })

  it('does not treat a shared prefix of letters as containment', () => {
    expect(activeHref('/administrators', hrefs)).toBeNull()
  })

  it('returns null when nothing matches', () => {
    expect(activeHref('/patient', hrefs)).toBeNull()
  })
})

describe('calendar arithmetic', () => {
  it('steps a day without a timezone ever moving it', () => {
    expect(shiftDate('2026-03-28', 1)).toBe('2026-03-29')
    // 29 March 2026 is the night the clocks go forward in most of Europe: 23 hours long.
    expect(shiftDate('2026-03-29', 1)).toBe('2026-03-30')
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDate('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('starts the week on Monday, whichever day it is given', () => {
    // 2026-09-12 is a Saturday; 2026-09-13 the Sunday that ends the same week.
    expect(weekdayOfDate('2026-09-12')).toBe(6)
    expect(startOfWeek('2026-09-12')).toBe('2026-09-07')
    expect(startOfWeek('2026-09-13')).toBe('2026-09-07')
    expect(startOfWeek('2026-09-07')).toBe('2026-09-07')
    expect(WEEK_ORDER[0]).toBe(1)
  })

  it('lists a range inclusively, and nothing when it runs backwards', () => {
    expect(datesBetween('2026-09-07', '2026-09-09')).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
    ])
    expect(datesBetween('2026-09-07', '2026-09-07')).toEqual(['2026-09-07'])
    expect(datesBetween('2026-09-09', '2026-09-07')).toEqual([])
  })

  it('rejects anything that is not a real calendar date', () => {
    expect(isCalendarDate('2026-09-12')).toBe(true)
    expect(isCalendarDate('2026-02-30')).toBe(false)
    expect(isCalendarDate('2026-9-12')).toBe(false)
    expect(isCalendarDate('')).toBe(false)
  })

  it('shows the clock face of an instant in the clinic timezone', () => {
    // 06:00 UTC is 09:00 in Beirut in September (UTC+3).
    expect(formatTimeOfDay('2026-09-12T06:00:00.000Z', 'en-GB', 'Asia/Beirut')).toBe('09:00')
    expect(formatTimeOfDay('2026-09-12T06:00:00.000Z', 'en-GB', 'UTC')).toBe('06:00')
  })
})

describe('calendar grouping', () => {
  const at = (id: string, startsAt: string, doctor: { id: string; name: string }) =>
    ({
      id,
      startsAt,
      doctor,
    }) as AppointmentSummary

  it('puts an appointment in the clinic day it falls on, not the UTC one', () => {
    // 21:30 UTC on the 12th is 00:30 on the 13th in Beirut: the clinic's next day.
    const groups = groupByDate(
      [at('a', '2026-09-12T21:30:00.000Z', { id: 'd1', name: 'Dr A' })],
      ['2026-09-12', '2026-09-13'],
      'Asia/Beirut',
    )
    expect(groups.map((group) => group.items.length)).toEqual([0, 1])
  })

  it('keeps a column for every day asked for, even an empty one', () => {
    expect(groupByDate([], ['2026-09-12', '2026-09-13'], 'UTC')).toHaveLength(2)
  })

  it('gives a column only to doctors who have something, in name order', () => {
    const columns = groupByDoctor([
      at('a', '2026-09-12T06:00:00.000Z', { id: 'd2', name: 'Dr Zaher' }),
      at('b', '2026-09-12T07:00:00.000Z', { id: 'd1', name: 'Dr Aoun' }),
      at('c', '2026-09-12T08:00:00.000Z', { id: 'd2', name: 'Dr Zaher' }),
    ])
    expect(columns.map((column) => column.name)).toEqual(['Dr Aoun', 'Dr Zaher'])
    expect(columns.map((column) => column.items.length)).toEqual([1, 2])
  })
})
