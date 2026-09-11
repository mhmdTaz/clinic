import { describe, expect, it } from 'vitest'
import { duplicateReasons, uncoveredCandidates, type MatchInput } from '../domain/duplicates'
import { birthDateIssue, formatMrn, parsePatientQuery } from '../domain/records'

const person = (overrides: Partial<MatchInput> = {}): MatchInput => ({
  firstName: 'Sara',
  lastName: 'Karam',
  dateOfBirth: '1991-03-14',
  nationalId: null,
  phone: null,
  email: null,
  ...overrides,
})

describe('duplicateReasons', () => {
  it('matches a phone number written two ways', () => {
    expect(
      duplicateReasons(person({ phone: '+961 3 123 456' }), person({ phone: '03-123456' })),
    ).toEqual(['PHONE', 'NAME_AND_DATE_OF_BIRTH'])
  })

  it('matches name and birth date ignoring case and accents', () => {
    expect(
      duplicateReasons(
        person({ firstName: 'Hélène', lastName: 'ABOU JAOUDE' }),
        person({ firstName: 'helene', lastName: 'Abou Jaoudé' }),
      ),
    ).toEqual(['NAME_AND_DATE_OF_BIRTH'])
  })

  it('never treats a shared name alone as a duplicate', () => {
    expect(duplicateReasons(person(), person({ dateOfBirth: '1992-03-14' }))).toEqual([])
    expect(duplicateReasons(person({ dateOfBirth: null }), person({ dateOfBirth: null }))).toEqual(
      [],
    )
  })

  it('matches identity numbers and emails however they were typed', () => {
    expect(
      duplicateReasons(
        person({ firstName: 'A', nationalId: 'lb-1234 567', email: 'Sara@Mail.com' }),
        person({ firstName: 'B', nationalId: 'LB1234567', email: 'sara@mail.com' }),
      ),
    ).toEqual(['NATIONAL_ID', 'EMAIL'])
  })
})

describe('uncoveredCandidates', () => {
  it('reports matches the override did not name — a record added a minute ago is a new warning', () => {
    expect(uncoveredCandidates(['p1', 'p2'], { candidateIds: ['p1'] })).toEqual(['p2'])
    expect(uncoveredCandidates(['p1'], null)).toEqual(['p1'])
  })
})

describe('parsePatientQuery', () => {
  it('reads record numbers in the ways people type them', () => {
    expect(parsePatientQuery('MRN-000142')).toEqual({ kind: 'mrn', value: 'MRN-000142' })
    expect(parsePatientQuery('mrn 142')).toEqual({ kind: 'mrn', value: 'MRN-000142' })
    expect(parsePatientQuery('142')).toEqual({ kind: 'mrn', value: 'MRN-000142' })
  })

  it('reads a phone number as a phone number', () => {
    expect(parsePatientQuery('+961 3 123 456')).toEqual({ kind: 'phone', value: '3123456' })
  })

  it('splits a two-word name so either order finds the person', () => {
    expect(parsePatientQuery('Sara Karam')).toEqual({
      kind: 'text',
      name: 'sara karam',
      first: 'sara',
      rest: 'karam',
      nationalId: null,
    })
  })

  it('tries an identity number when the text has digits in it', () => {
    expect(parsePatientQuery('LB-12345')).toMatchObject({ kind: 'text', nationalId: 'LB12345' })
    expect(parsePatientQuery('   ')).toBeNull()
  })
})

describe('records', () => {
  it('pads record numbers to six digits', () => {
    expect(formatMrn(142)).toBe('MRN-000142')
    expect(formatMrn(1_000_001)).toBe('MRN-1000001')
  })

  it('refuses birth dates in the future or before 1900', () => {
    expect(birthDateIssue('2026-09-12', '2026-09-11')).toBe('IN_FUTURE')
    expect(birthDateIssue('1899-12-31', '2026-09-11')).toBe('TOO_EARLY')
    expect(birthDateIssue('2026-09-11', '2026-09-11')).toBeNull()
    expect(birthDateIssue(null, '2026-09-11')).toBeNull()
  })
})
