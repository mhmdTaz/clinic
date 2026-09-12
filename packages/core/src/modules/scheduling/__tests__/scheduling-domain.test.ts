import { describe, expect, it } from 'vitest'
import { bookingRefusal, bookingWindowOf, withinCancellationWindow } from '../domain/booking-window'
import { floorToGrid, gridCellIds, sitsOnGrid } from '../domain/grid'
import { computeSlots } from '../domain/slots'
import { eachDate, instantOf, localMoment, weekdayOf } from '../domain/zoned-time'

const BEIRUT = 'Asia/Beirut'

describe('clinic-local time', () => {
  it('reads a wall-clock time as an instant, on both sides of a daylight-saving change', () => {
    // Beirut is +3 in summer and +2 in winter, so the same 09:00 is two different instants.
    expect(instantOf('2026-09-15', '09:00', BEIRUT).toISOString()).toBe('2026-09-15T06:00:00.000Z')
    expect(instantOf('2026-12-15', '09:00', BEIRUT).toISOString()).toBe('2026-12-15T07:00:00.000Z')
  })

  it('reads an instant back as the clinic sees it', () => {
    const moment = localMoment(new Date('2026-09-15T06:30:00.000Z'), BEIRUT)
    expect(moment).toEqual({ date: '2026-09-15', time: '09:30', dayOfWeek: 2 })
  })

  it('walks calendar dates across a month end', () => {
    expect(eachDate('2026-02-27', '2026-03-02')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ])
    expect(eachDate('2026-09-15', '2026-09-15')).toEqual(['2026-09-15'])
  })

  it('names the weekday from the date alone, with Sunday as 0', () => {
    expect(weekdayOf('2026-09-13')).toBe(0)
    expect(weekdayOf('2026-09-15')).toBe(2)
  })
})

describe('the reservation grid', () => {
  it('covers every five-minute cell an appointment occupies', () => {
    const cells = gridCellIds(
      'doc1',
      new Date('2026-09-15T06:00:00.000Z'),
      new Date('2026-09-15T06:30:00.000Z'),
    )
    expect(cells).toHaveLength(6)
    expect(cells[0]).toBe('doc1:2026-09-15T06:00:00.000Z')
    expect(cells.at(-1)).toBe('doc1:2026-09-15T06:25:00.000Z')
  })

  it('starts from the cell a mid-cell start falls in, so the overlap is still caught', () => {
    expect(floorToGrid(new Date('2026-09-15T06:07:00.000Z')).toISOString()).toBe(
      '2026-09-15T06:05:00.000Z',
    )
  })

  it('knows which durations the grid holds exactly', () => {
    const onGrid = new Date('2026-09-15T06:00:00.000Z')
    expect(sitsOnGrid(onGrid, 30)).toBe(true)
    expect(sitsOnGrid(onGrid, 7)).toBe(false)
    expect(sitsOnGrid(new Date('2026-09-15T06:02:00.000Z'), 30)).toBe(false)
  })
})

describe('the self-service booking window', () => {
  const now = new Date('2026-09-15T06:00:00.000Z')
  const window = bookingWindowOf({ horizonDays: 30, minimumNoticeHours: 2 })

  it('falls back to the clinic defaults for anything unset', () => {
    expect(window.cancellationCutoffHours).toBe(24)
  })

  it('refuses what is too soon and what is too far ahead', () => {
    expect(bookingRefusal(new Date('2026-09-15T07:00:00.000Z'), window, now)).toBe('TOO_SOON')
    expect(bookingRefusal(new Date('2026-11-15T09:00:00.000Z'), window, now)).toBe('BEYOND_HORIZON')
    expect(bookingRefusal(new Date('2026-09-16T09:00:00.000Z'), window, now)).toBeNull()
  })

  it('closes the door on self-service changes inside the cutoff', () => {
    expect(withinCancellationWindow(new Date('2026-09-17T06:00:00.000Z'), window, now)).toBe(true)
    expect(withinCancellationWindow(new Date('2026-09-15T18:00:00.000Z'), window, now)).toBe(false)
  })
})

describe('computing a doctor’s slots', () => {
  const tuesdayMorning = [{ dayOfWeek: 2, startsAt: '09:00', endsAt: '12:00' }]
  const base = {
    from: '2026-09-14',
    to: '2026-09-16',
    timeZone: BEIRUT,
    blocks: tuesdayMorning,
    timeOff: [],
    closedDates: [],
    busy: [],
    durationMinutes: 30,
    notBefore: new Date('2026-09-01T00:00:00.000Z'),
  }

  it('offers one per appointment length inside the block, and nothing on other days', () => {
    const days = computeSlots(base)
    expect(days.map((day) => day.date)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16'])

    const tuesday = days[1]
    expect(tuesday?.slots).toHaveLength(6)
    expect(tuesday?.slots[0]?.startsAt.toISOString()).toBe('2026-09-15T06:00:00.000Z')
    expect(tuesday?.slots.at(-1)?.endsAt.toISOString()).toBe('2026-09-15T09:00:00.000Z')
    expect(days[0]?.slots).toEqual([])
    expect(days[2]?.slots).toEqual([])
  })

  it('drops the offers an existing appointment overlaps, and keeps the rest', () => {
    const days = computeSlots({
      ...base,
      busy: [
        {
          startsAt: new Date('2026-09-15T06:15:00.000Z'),
          endsAt: new Date('2026-09-15T06:45:00.000Z'),
        },
      ],
    })
    const starts = days[1]?.slots.map((slot) => slot.startsAt.toISOString())
    expect(starts).toEqual([
      '2026-09-15T07:00:00.000Z',
      '2026-09-15T07:30:00.000Z',
      '2026-09-15T08:00:00.000Z',
      '2026-09-15T08:30:00.000Z',
    ])
  })

  it('offers nothing on a day off or a day the clinic is closed', () => {
    expect(
      computeSlots({ ...base, timeOff: [{ startDate: '2026-09-15', endDate: '2026-09-15' }] })[1]
        ?.slots,
    ).toEqual([])
    expect(computeSlots({ ...base, closedDates: ['2026-09-15'] })[1]?.slots).toEqual([])
  })

  it('never offers a slot before the notice the clinic requires', () => {
    const days = computeSlots({ ...base, notBefore: new Date('2026-09-15T07:10:00.000Z') })
    expect(days[1]?.slots.map((slot) => slot.startsAt.toISOString())).toEqual([
      '2026-09-15T07:30:00.000Z',
      '2026-09-15T08:00:00.000Z',
      '2026-09-15T08:30:00.000Z',
    ])
  })

  it('keeps the block on the clinic’s wall clock when the offset changes', () => {
    const december = computeSlots({ ...base, from: '2026-12-15', to: '2026-12-15' })
    expect(december[0]?.slots[0]?.startsAt.toISOString()).toBe('2026-12-15T07:00:00.000Z')
  })
})
