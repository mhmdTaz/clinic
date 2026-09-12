import { describe, expect, it } from 'vitest'
import { addQuantities } from '@clinic/contracts'
import { allocateFefo, allocateFromBatch, totalOf, type BatchLike } from '../domain/stock'
import { expiryState, horizonDate, isLowStock, nextExpiry } from '../domain/alerts'

const TODAY = '2026-09-15'

const batch = (overrides: Partial<BatchLike> & { id: string }): BatchLike => ({
  batchNumber: null,
  expiresAt: null,
  quantity: '10',
  ...overrides,
})

describe('taking stock off the shelf', () => {
  /** FEFO: the box about to become worthless goes first, or the clinic throws it away. */
  it('takes from the batch that expires soonest', () => {
    const batches = [
      batch({ id: 'later', expiresAt: '2027-01-01', quantity: '10' }),
      batch({ id: 'sooner', expiresAt: '2026-11-01', quantity: '10' }),
    ]
    const result = allocateFefo(batches, '4', TODAY)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.allocations).toEqual([
      { batchId: 'sooner', batchNumber: null, quantity: '4.000' },
    ])
  })

  it('writes every allocated quantity the same way, whole batch or partial', () => {
    const batches = [
      batch({ id: 'whole', expiresAt: '2026-10-01', quantity: '3' }),
      batch({ id: 'partial', expiresAt: '2027-01-01', quantity: '10' }),
    ]
    const result = allocateFefo(batches, '5', TODAY)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // "3" taken whole and "2" taken partially both come back at three places.
    expect(result.allocations.map((row) => row.quantity)).toEqual(['3.000', '2.000'])
  })

  it('spills into the next batch when the first cannot cover it', () => {
    const batches = [
      batch({ id: 'sooner', expiresAt: '2026-11-01', quantity: '3' }),
      batch({ id: 'later', expiresAt: '2027-01-01', quantity: '10' }),
    ]
    const result = allocateFefo(batches, '7', TODAY)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.allocations).toEqual([
      { batchId: 'sooner', batchNumber: null, quantity: '3.000' },
      { batchId: 'later', batchNumber: null, quantity: '4.000' },
    ])
    // Whatever the split, it adds up to what was asked for.
    expect(addQuantities(...result.allocations.map((row) => row.quantity))).toBe('7.000')
  })

  it('uses dated stock before undated stock', () => {
    const batches = [
      batch({ id: 'undated', expiresAt: null, quantity: '10' }),
      batch({ id: 'dated', expiresAt: '2027-06-01', quantity: '10' }),
    ]
    const result = allocateFefo(batches, '2', TODAY)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.allocations[0]?.batchId).toBe('dated')
  })

  it('skips empty batches rather than allocating nothing from them', () => {
    const batches = [
      batch({ id: 'empty', expiresAt: '2026-10-01', quantity: '0' }),
      batch({ id: 'full', expiresAt: '2027-01-01', quantity: '5' }),
    ]
    const result = allocateFefo(batches, '2', TODAY)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.allocations).toEqual([{ batchId: 'full', batchNumber: null, quantity: '2.000' }])
  })

  /**
   * Expired stock is still on the shelf and still counted, but it is not something to put into
   * a patient — and saying *which* kind of shortage it is matters, because "order more" and
   * "write off what you have" are entirely different jobs.
   */
  it('refuses expired stock, and says that is why', () => {
    const batches = [batch({ id: 'old', expiresAt: '2026-09-14', quantity: '10' })]
    const result = allocateFefo(batches, '2', TODAY)

    expect(result).toEqual({ ok: false, reason: 'STOCK_EXPIRED', usable: '0.000' })
  })

  it('counts stock expiring today as usable', () => {
    const batches = [batch({ id: 'today', expiresAt: TODAY, quantity: '10' })]
    const result = allocateFefo(batches, '2', TODAY)

    expect(result.ok).toBe(true)
  })

  it('says there is not enough when there simply is not', () => {
    const batches = [batch({ id: 'some', expiresAt: '2027-01-01', quantity: '1.5' })]
    expect(allocateFefo(batches, '2', TODAY)).toEqual({
      ok: false,
      reason: 'INSUFFICIENT_STOCK',
      usable: '1.500',
    })
    expect(allocateFefo([], '1', TODAY)).toEqual({
      ok: false,
      reason: 'INSUFFICIENT_STOCK',
      usable: '0.000',
    })
  })

  it('handles a fractional quantity without drifting', () => {
    const batches = [
      batch({ id: 'a', expiresAt: '2026-10-01', quantity: '0.5' }),
      batch({ id: 'b', expiresAt: '2026-11-01', quantity: '0.5' }),
      batch({ id: 'c', expiresAt: '2026-12-01', quantity: '0.5' }),
    ]
    const result = allocateFefo(batches, '1.25', TODAY)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(addQuantities(...result.allocations.map((row) => row.quantity))).toBe('1.250')
    expect(result.allocations.map((row) => row.batchId)).toEqual(['a', 'b', 'c'])
  })

  it('adds up what the shelf holds, expired stock included', () => {
    expect(
      totalOf([
        batch({ id: 'a', quantity: '2.5' }),
        batch({ id: 'b', expiresAt: '2020-01-01', quantity: '1.5' }),
      ]),
    ).toBe('4.000')
  })
})

describe('taking from a named batch', () => {
  const batches = [
    batch({ id: 'chosen', batchNumber: 'LOT-7', expiresAt: '2027-01-01', quantity: '5' }),
    batch({ id: 'other', expiresAt: '2026-10-01', quantity: '50' }),
  ]

  /** Somebody at the shelf holding a particular box knows more than the sort order does. */
  it('overrides the expiry order when a batch is named', () => {
    const result = allocateFromBatch(batches, 'chosen', '2', TODAY)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.allocations).toEqual([
      { batchId: 'chosen', batchNumber: 'LOT-7', quantity: '2.000' },
    ])
  })

  it('still refuses a batch that does not hold enough', () => {
    expect(allocateFromBatch(batches, 'chosen', '6', TODAY)).toEqual({
      ok: false,
      reason: 'INSUFFICIENT_STOCK',
      usable: '5.000',
    })
  })

  it('still refuses an expired batch, however deliberately it was chosen', () => {
    const expired = [batch({ id: 'old', expiresAt: '2026-09-01', quantity: '99' })]
    expect(allocateFromBatch(expired, 'old', '1', TODAY)).toMatchObject({
      ok: false,
      reason: 'STOCK_EXPIRED',
    })
  })

  it('refuses a batch that is not there', () => {
    expect(allocateFromBatch(batches, 'ghost', '1', TODAY)).toMatchObject({ ok: false })
  })
})

describe('what needs attention', () => {
  it('is low at or below the reorder level', () => {
    expect(isLowStock('5', '10')).toBe(true)
    expect(isLowStock('10', '10')).toBe(true)
    expect(isLowStock('11', '10')).toBe(false)
  })

  it('never warns about an item with no level set', () => {
    // Gauze does not need a threshold, and "always low" is not a useful alert.
    expect(isLowStock('0', '0')).toBe(false)
  })

  it('reports the soonest expiry among batches that still hold something', () => {
    expect(
      nextExpiry([
        batch({ id: 'a', expiresAt: '2027-01-01', quantity: '5' }),
        batch({ id: 'b', expiresAt: '2026-10-01', quantity: '0' }),
        batch({ id: 'c', expiresAt: '2026-12-01', quantity: '2' }),
      ]),
    ).toBe('2026-12-01')
    expect(nextExpiry([batch({ id: 'a', quantity: '5' })])).toBeNull()
    expect(nextExpiry([])).toBeNull()
  })

  it('places an expiry against today and the horizon', () => {
    const horizon = horizonDate(TODAY, 90)
    expect(horizon).toBe('2026-12-14')
    expect(expiryState(null, TODAY, horizon)).toBe('NONE')
    expect(expiryState('2026-09-14', TODAY, horizon)).toBe('EXPIRED')
    expect(expiryState(TODAY, TODAY, horizon)).toBe('SOON')
    expect(expiryState('2026-12-14', TODAY, horizon)).toBe('SOON')
    expect(expiryState('2026-12-15', TODAY, horizon)).toBe('NONE')
  })

  it('crosses a year boundary correctly', () => {
    expect(horizonDate('2026-12-20', 30)).toBe('2027-01-19')
    // 2028 is a leap year: February has 29 days.
    expect(horizonDate('2028-02-28', 1)).toBe('2028-02-29')
  })
})
