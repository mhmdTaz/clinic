import { describe, expect, it } from 'vitest'
import {
  decodeCursor,
  encodeCursor,
  keysetAfter,
  pageFrom,
  pageLimit,
  sortFor,
  type SortKey,
} from '../pagination'

const newestFirst: SortKey[] = [
  { field: 'startedAt', direction: -1, kind: 'date' },
  { field: '_id', direction: -1, kind: 'string' },
]

describe('the rows after a cursor', () => {
  it('runs each field in its own direction, with the id as the tie-breaker', () => {
    const condition = keysetAfter(newestFirst, ['2026-09-20T09:00:00.000Z', 'e_5'])
    expect(condition).toEqual({
      $or: [
        { startedAt: { $lt: new Date('2026-09-20T09:00:00.000Z') } },
        { startedAt: new Date('2026-09-20T09:00:00.000Z'), _id: { $lt: 'e_5' } },
      ],
    })
  })

  /**
   * MongoDB orders different BSON types by type before value, so an ISO string is never less than
   * a stored date: a cursor compared as a string would hand back the whole collection as page two.
   */
  it('compares a date as a date, never as the string it travelled as', () => {
    const condition = keysetAfter(newestFirst, ['2026-09-20T09:00:00.000Z', 'e_5']) as {
      $or: Array<Record<string, { $lt?: unknown }>>
    }
    expect(condition.$or[0]?.startedAt?.$lt).toBeInstanceOf(Date)
  })

  it('refuses a cursor whose date is not a date, or whose shape is wrong', () => {
    expect(() => keysetAfter(newestFirst, ['yesterday', 'e_5'])).toThrow(/cursor/)
    expect(() => keysetAfter(newestFirst, ['2026-09-20T09:00:00.000Z'])).toThrow(/cursor/)
    expect(() => decodeCursor('not-base64-json', 2)).toThrow(/cursor/)
  })

  it('sorts the way the cursor reads', () => {
    expect(sortFor(newestFirst)).toEqual({ startedAt: -1, _id: -1 })
  })
})

describe('a page', () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      _id: `e_${9 - index}`,
      startedAt: new Date(Date.UTC(2026, 8, 20, 9, 0) - index * 60_000),
    }))

  it('offers a next page only when there is one', () => {
    // Read limit + 1: whether the extra row came back is the only honest test.
    expect(pageFrom(rows(3), 3, newestFirst).nextCursor).toBeNull()
    const page = pageFrom(rows(4), 3, newestFirst)
    expect(page.docs).toHaveLength(3)
    expect(decodeCursor(page.nextCursor ?? '', 2)).toEqual(['2026-09-20T08:58:00.000Z', 'e_7'])
  })

  it('reads a nested sort field', () => {
    const docs = [
      { _id: 'i_1', search: { name: 'amoxicillin' } },
      { _id: 'i_2', search: { name: 'bandage' } },
    ]
    const keys: SortKey[] = [
      { field: 'search.name', direction: 1, kind: 'string' },
      { field: '_id', direction: 1, kind: 'string' },
    ]
    expect(decodeCursor(pageFrom(docs, 1, keys).nextCursor ?? '', 2)).toEqual([
      'amoxicillin',
      'i_1',
    ])
  })

  it('never asks for more than the contract allows, nor for nothing', () => {
    expect(pageLimit(undefined)).toBe(25)
    expect(pageLimit(1000)).toBe(100)
    expect(pageLimit(0)).toBe(1)
    expect(encodeCursor(['a', null])).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
