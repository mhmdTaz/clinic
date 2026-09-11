import { describe, expect, it } from 'vitest'
import { activeHref } from '../../components/shell/nav-utils'
import { partOfDay } from '../format/greeting'
import { describeUserAgent } from '../format/user-agent'
import { WEEK_ORDER, weekdayName } from '../format/weekdays'

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
