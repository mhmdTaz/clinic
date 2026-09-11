import { describe, expect, it } from 'vitest'
import { leavesAnActiveBranch, upcomingHolidays } from '../domain/clinic'

describe('leavesAnActiveBranch', () => {
  const branches = [
    { id: 'main', isActive: true },
    { id: 'north', isActive: false },
  ]

  it('refuses to close the only open location', () => {
    expect(leavesAnActiveBranch(branches, { branchId: 'main', isActive: false })).toBe(false)
  })

  it('allows it once another location is open', () => {
    expect(
      leavesAnActiveBranch([...branches, { id: 'south', isActive: true }], {
        branchId: 'main',
        isActive: false,
      }),
    ).toBe(true)
    expect(leavesAnActiveBranch(branches, { branchId: 'north', isActive: true })).toBe(true)
  })
})

describe('upcomingHolidays', () => {
  it('starts from today, soonest first', () => {
    const holidays = [
      { date: '2026-12-25', name: 'Christmas' },
      { date: '2026-09-10', name: 'Past' },
      { date: '2026-09-11', name: 'Today' },
    ]
    expect(upcomingHolidays(holidays, '2026-09-11').map((holiday) => holiday.name)).toEqual([
      'Today',
      'Christmas',
    ])
  })

  it('shows only the next few', () => {
    const holidays = Array.from({ length: 8 }, (_, day) => ({
      date: `2027-01-0${day + 1}`,
      name: `Day ${day + 1}`,
    }))
    expect(upcomingHolidays(holidays, '2026-12-31', 3)).toHaveLength(3)
  })
})
