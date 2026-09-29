import { describe, expect, it } from 'vitest'
import {
  COUNTRY_CODES,
  CountryCode,
  RENAMED_COUNTRIES,
  RETIRED_COUNTRIES,
  canonicalCountry,
  isCountryCode,
  nullableCountry,
} from '../index'

const issueOf = (value: unknown) => {
  const result = CountryCode.safeParse(value)
  return result.success ? null : result.error.issues.map((issue) => issue.message)
}

/** Audit F04: one code per country, and never a guess about a country that no longer exists. */
describe('the country list', () => {
  it('is ISO 3166-1’s 249 assigned codes plus Kosovo, each once', () => {
    expect(COUNTRY_CODES).toHaveLength(250)
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length)
    expect(COUNTRY_CODES).toContain('XK')
    for (const code of COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/)
  })

  it('gives every current country one name — no two codes read as the same country', () => {
    const names = new Intl.DisplayNames(['en'], { type: 'region' })
    const byName = new Map<string, string[]>()
    for (const code of COUNTRY_CODES) {
      const name = names.of(code)
      expect(name, code).toBeTruthy()
      expect(name, code).not.toBe(code)
      byName.set(name ?? code, [...(byName.get(name ?? code) ?? []), code])
    }
    const doubled = [...byName].filter(([, codes]) => codes.length > 1)
    expect(doubled).toEqual([])
  })

  it('keeps old codes out of the current list, and every rename pointing at a current code', () => {
    for (const [old, current] of Object.entries(RENAMED_COUNTRIES)) {
      expect(isCountryCode(old), old).toBe(false)
      expect(isCountryCode(current), current).toBe(true)
    }
    for (const retired of RETIRED_COUNTRIES) {
      expect(isCountryCode(retired), retired).toBe(false)
      expect(retired in RENAMED_COUNTRIES, retired).toBe(false)
    }
  })

  it('offers what was offered before, less only the duplicates and the non-countries', () => {
    for (const code of [
      'LB',
      'SY',
      'JO',
      'FR',
      'DE',
      'GB',
      'US',
      'RS',
      'ME',
      'CW',
      'SS',
      'PS',
      'TW',
    ]) {
      expect(isCountryCode(code), code).toBe(true)
    }
  })
})

describe('validating a country', () => {
  it('accepts a current code, in any case and with stray spaces', () => {
    expect(CountryCode.parse('LB')).toBe('LB')
    expect(CountryCode.parse(' lb ')).toBe('LB')
    expect(nullableCountry.parse('')).toBeNull()
    expect(nullableCountry.parse(null)).toBeNull()
  })

  it('reads an old code for a country that still exists as its current code', () => {
    expect(CountryCode.parse('UK')).toBe('GB')
    expect(CountryCode.parse('dd')).toBe('DE')
    expect(CountryCode.parse('ZR')).toBe('CD')
    expect(canonicalCountry('BU')).toBe('MM')
    expect(canonicalCountry('LB')).toBe('LB')
  })

  it('refuses a code that no longer means one country, and says so distinctly', () => {
    for (const code of ['YU', 'CS', 'SU', 'AN', 'IC']) {
      expect(issueOf(code), code).toEqual(['RETIRED_COUNTRY'])
    }
  })

  it('refuses what was never a country', () => {
    for (const code of ['QQ', 'EU', 'UN', 'ZZ', 'XA', 'L', 'LBN', '12']) {
      expect(issueOf(code), code).toEqual(['INVALID_COUNTRY'])
    }
  })
})
