import { describe, expect, it } from 'vitest'
import { assessPassword } from '../domain/password-policy'

describe('assessPassword', () => {
  it('accepts a long passphrase with no composition rules to satisfy', () => {
    expect(assessPassword('correct horse battery staple')).toEqual([])
  })

  it('accepts a passphrase in Arabic script', () => {
    expect(assessPassword('شمس الصباح فوق بيروت')).toEqual([])
  })

  it('counts length in code points, so twelve emoji are twelve characters', () => {
    expect(assessPassword('😀😁😂🤣😃😄😅😆😉😊😋😎')).toEqual([])
  })

  it('does not let surrogate pairs inflate a short password past the minimum', () => {
    // 11 code points, but 22 UTF-16 units: a naive .length check would accept it.
    expect(assessPassword('😀😁😂🤣😃😄😅😆😉😊😋'.slice(0, 22))).toContain('TOO_SHORT')
  })

  it('rejects anything under 12 characters', () => {
    expect(assessPassword('short-pw-1')).toContain('TOO_SHORT')
  })

  it('rejects anything over 128 characters', () => {
    expect(assessPassword('abcdefghij'.repeat(13))).toContain('TOO_LONG')
  })

  it('rejects well-known long passwords', () => {
    expect(assessPassword('qwerty123456')).toContain('TOO_COMMON')
    expect(assessPassword('1q2w3e4r5t6y')).toContain('TOO_COMMON')
  })

  it('sees through a common word padded with digits and symbols', () => {
    expect(assessPassword('Password2026!!')).toContain('TOO_COMMON')
    expect(assessPassword('Welcome@12345')).toContain('TOO_COMMON')
    expect(assessPassword('Clinic#2026#2026')).toContain('TOO_COMMON')
  })

  it('does not reject a common word that is only part of something longer', () => {
    expect(assessPassword('password-manager-for-nana')).toEqual([])
  })

  it('rejects passwords made of too few distinct characters', () => {
    expect(assessPassword('aaaaaaaaaaaaaa')).toContain('TOO_REPETITIVE')
    expect(assessPassword('abababababab')).toContain('TOO_REPETITIVE')
  })

  it('rejects a password containing the email name or the person’s name', () => {
    expect(assessPassword('sara.karam-loves-2026', { email: 'sara.karam@clinic.local' })).toContain(
      'CONTAINS_PERSONAL_INFO',
    )
    expect(assessPassword('Nabil-cardiology-2026', { firstName: 'Nabil' })).toContain(
      'CONTAINS_PERSONAL_INFO',
    )
  })

  it('ignores name fragments too short to be meaningful', () => {
    expect(assessPassword('al-quiet-morning-tea', { firstName: 'Al' })).toEqual([])
  })
})
