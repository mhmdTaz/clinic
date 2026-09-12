import { describe, expect, it } from 'vitest'
import { REDACTED_MARKER } from '@clinic/config'
import { csvCell, csvRow, fieldChanges, render } from '../domain/diff'

describe('fieldChanges', () => {
  it('pairs a before with its after', () => {
    expect(fieldChanges({ status: 'ACTIVE' }, { status: 'SUSPENDED' })).toEqual([
      { field: 'status', before: 'ACTIVE', after: 'SUSPENDED', isRedacted: false },
    ])
  })

  it('sorts fields, so the same edit reads the same way twice', () => {
    const one = fieldChanges({ zebra: 1, alpha: 2 }, { zebra: 3, alpha: 4 })
    const two = fieldChanges({ alpha: 2, zebra: 1 }, { alpha: 4, zebra: 3 })
    expect(one.map((change) => change.field)).toEqual(['alpha', 'zebra'])
    expect(one).toEqual(two)
  })

  it('shows a field that was added, with no before', () => {
    expect(fieldChanges({}, { bloodType: 'O_POSITIVE' })).toEqual([
      { field: 'bloodType', before: null, after: 'O_POSITIVE', isRedacted: false },
    ])
  })

  it('shows a field that was cleared, with no after', () => {
    expect(fieldChanges({ phone: '+961 1 000 000' }, {})).toEqual([
      { field: 'phone', before: '+961 1 000 000', after: null, isRedacted: false },
    ])
  })

  it('flags a redacted value on either side', () => {
    const changes = fieldChanges(
      { passwordHash: REDACTED_MARKER },
      { passwordHash: REDACTED_MARKER },
    )
    expect(changes[0]?.isRedacted).toBe(true)
    // The marker is still what is rendered: the viewer shows a change happened, not the value.
    expect(changes[0]?.after).toBe(REDACTED_MARKER)
  })

  it('handles a missing diff — plenty of entries record an act, not a change', () => {
    expect(fieldChanges(null, null)).toEqual([])
    expect(fieldChanges(undefined, undefined)).toEqual([])
  })
})

describe('render', () => {
  it('keeps null distinct from the string "null"', () => {
    expect(render(null)).toBeNull()
    expect(render(undefined)).toBeNull()
    expect(render('null')).toBe('null')
  })

  it('renders false and zero rather than treating them as absent', () => {
    expect(render(false)).toBe('false')
    expect(render(0)).toBe('0')
  })

  it('uses ISO for dates, so two timestamps compare character by character', () => {
    expect(render(new Date('2026-09-12T10:00:00Z'))).toBe('2026-09-12T10:00:00.000Z')
  })

  it('serialises an object rather than printing [object Object]', () => {
    expect(render({ city: 'Beirut' })).toBe('{"city":"Beirut"}')
  })
})

describe('csvCell', () => {
  it('quotes every cell, so a comma in a name does not become a column', () => {
    expect(csvCell('Haddad, Nadia')).toBe('"Haddad, Nadia"')
  })

  it('doubles an embedded quote, per RFC 4180', () => {
    expect(csvCell('she said "no"')).toBe('"she said ""no"""')
  })

  it('neutralises a formula, which quoting alone does not', () => {
    // A spreadsheet strips the quotes and then evaluates. The apostrophe is the actual defence.
    expect(csvCell('=1+1')).toBe(`"'=1+1"`)
    expect(csvCell('+41 79 000 00 00')).toBe(`"'+41 79 000 00 00"`)
    expect(csvCell('-lookup')).toBe(`"'-lookup"`)
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`)
  })

  it('leaves an ordinary value alone', () => {
    expect(csvCell('patient.viewed')).toBe('"patient.viewed"')
  })
})

describe('csvRow', () => {
  it('joins quoted cells with commas', () => {
    expect(csvRow(['a', 'b,c'])).toBe('"a","b,c"')
  })
})
