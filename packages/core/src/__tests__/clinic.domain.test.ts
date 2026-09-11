import { describe, expect, it } from 'vitest'
import { activeBranches, hasBookableBranch, type Clinic } from '../modules/clinic/domain/clinic'

const clinic = (branches: Clinic['branches']): Clinic => ({
  id: 'c1',
  name: 'Demo',
  timezone: 'Asia/Beirut',
  currency: 'USD',
  locale: 'en',
  branches,
})

describe('clinic domain', () => {
  it('is bookable when at least one branch is active', () => {
    expect(hasBookableBranch(clinic([{ id: 'b1', name: 'Main', isActive: true }]))).toBe(true)
  })

  it('is not bookable with no branches at all', () => {
    expect(hasBookableBranch(clinic([]))).toBe(false)
  })

  it('is not bookable when every branch is deactivated', () => {
    expect(
      hasBookableBranch(
        clinic([
          { id: 'b1', name: 'Main', isActive: false },
          { id: 'b2', name: 'Annex', isActive: false },
        ]),
      ),
    ).toBe(false)
  })

  it('lists only active branches', () => {
    const result = activeBranches(
      clinic([
        { id: 'b1', name: 'Main', isActive: true },
        { id: 'b2', name: 'Closed', isActive: false },
      ]),
    )
    expect(result.map((b) => b.id)).toEqual(['b1'])
  })
})
