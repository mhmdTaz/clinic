import { describe, expect, it } from 'vitest'
import { emailKey, escapeRegex, nameKey, nationalIdKey, phoneKey } from '../text-keys'

describe('nameKey', () => {
  it('folds case and accents so a plain search finds an accented name', () => {
    expect(nameKey('Hélène')).toBe('helene')
    expect(nameKey('  KHOURY ')).toBe('khoury')
  })

  it('collapses inner whitespace', () => {
    expect(nameKey('Abou   Jaoude')).toBe('abou jaoude')
  })

  it('strips Arabic diacritics but keeps the letters', () => {
    expect(nameKey('سَارَة')).toBe('سارة')
  })

  it('treats blank as no key at all', () => {
    expect(nameKey('   ')).toBeNull()
    expect(nameKey(null)).toBeNull()
  })
})

describe('phoneKey', () => {
  it('matches a local and an international spelling of the same number', () => {
    expect(phoneKey('+961 3 123 456')).toBe(phoneKey('03 123 456'))
    expect(phoneKey('+961 70 123 456')).toBe(phoneKey('70-123-456'))
  })

  it('keeps numbers on different lines apart', () => {
    expect(phoneKey('01 123 456')).not.toBe(phoneKey('03 123 456'))
  })

  it('refuses to key something too short to be a phone number', () => {
    expect(phoneKey('12345')).toBeNull()
    expect(phoneKey('')).toBeNull()
  })
})

describe('emailKey and nationalIdKey', () => {
  it('lower-cases email addresses', () => {
    expect(emailKey(' Sara@Clinic.Local ')).toBe('sara@clinic.local')
  })

  it('ignores the separators people type into identity numbers', () => {
    expect(nationalIdKey('lb 123-456/7')).toBe('LB1234567')
    expect(nationalIdKey(' - ')).toBeNull()
  })
})

describe('escapeRegex', () => {
  it('makes every special character literal', () => {
    const pattern = new RegExp(`^${escapeRegex('a.b*(c)')}$`)
    expect(pattern.test('a.b*(c)')).toBe(true)
    expect(pattern.test('axb*(c)')).toBe(false)
  })
})
